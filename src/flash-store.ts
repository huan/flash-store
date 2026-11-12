/**
 * Implements the asynchronous Map-like API over an LMDB environment.
 * It owns the database lifecycle, key validation, and JSON serialization. The
 * synchronous facade builds on this API and its internal serialized-write hook.
 * This module also enforces single-process ownership of each workdir so only
 * one store instance can write a database directory at a time.
 */
import { channel } from 'node:diagnostics_channel'
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { parse, resolve } from 'node:path'
import { IF_EXISTS, open, type RootDatabase } from 'lmdb'
import { log, VERSION } from './config.ts'

/** Keys are ordered by LMDB: numbers precede strings and each type is ordered naturally. */
export type StoreKey = string | number

/** Bounds and ordering for a range of keys. Prefix is restricted to string keys. */
export interface IteratorOptions<K extends StoreKey = StoreKey> {
  gt?: K
  gte?: K
  lt?: K
  lte?: K
  reverse?: boolean
  limit?: number
  prefix?: string
}

const operations = channel('flash-store.operation')
const WORKDIR_LOCK_FILE = '.flash-store.lock'

/** Tracks a process-local exclusive lock file for one LMDB workdir. */
interface WorkdirLock {
  fd: number
  path: string
  released: boolean
}

/**
 * Acquire an exclusive lock for the workdir before opening LMDB.
 * The lock file prevents multiple FlashStore instances in different processes
 * from concurrently writing the same database files.
 */
function acquireWorkdirLock(workdir: string): WorkdirLock {
  mkdirSync(workdir, { recursive: true })
  const lockPath = resolve(workdir, WORKDIR_LOCK_FILE)
  try {
    const fd = openSync(lockPath, 'wx')
    return { fd, path: lockPath, released: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        `FlashStore workdir is already in use by another process: ${workdir}`,
      )
    }
    throw error
  }
}

/**
 * Release the exclusive workdir lock.
 * Lock cleanup is best-effort because close() should preserve LMDB close errors
 * and not replace them with lock file cleanup failures.
 */
function releaseWorkdirLock(lock: WorkdirLock): void {
  if (lock.released) return
  lock.released = true
  try {
    closeSync(lock.fd)
  } finally {
    try {
      rmSync(lock.path, { force: true })
    } catch {
      // Ignore cleanup errors so they do not mask database close behavior.
    }
  }
}

/** Reject keys that the configured ordered-binary encoding cannot represent safely. */
export function validateKey(key: StoreKey): void {
  if (
    (typeof key === 'number' && !Number.isFinite(key)) ||
    (typeof key === 'string' && key.includes('\0')) ||
    (typeof key !== 'number' && typeof key !== 'string')
  ) {
    throw new TypeError(
      'Keys must be finite numbers or strings without null characters',
    )
  }
}

/** Serialize a value once, rejecting values that JSON cannot represent. */
export function serialize(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined)
    throw new TypeError('Value must be JSON serializable')
  return serialized
}

/**
 * Return the smallest string after every string starting with `prefix`, or
 * undefined when none exists. LMDB orders strings by UTF-8 bytes, which matches
 * code point order, so matching keys form one contiguous interval.
 */
function prefixEnd(prefix: string): string | undefined {
  const codePoints = Array.from(prefix)
  while (codePoints.length > 0) {
    const last = codePoints.pop()?.codePointAt(0)
    if (last !== undefined && last < 0x10ffff) {
      // Surrogate code points are not encodable scalar values; skip them.
      const next = last === 0xd7ff ? 0xe000 : last + 1
      return codePoints.join('') + String.fromCodePoint(next)
    }
  }
  return undefined
}

/** Start reverse prefix scans just below the interval end, or at the database end. */
function prefixRange(prefix: string) {
  const end = prefixEnd(prefix)
  return { start: end, reverse: true, exclusiveStart: end !== undefined }
}

/**
 * Writes pre-serialized JSON for FlashStoreSync, which serializes at call time.
 * Internal: mod.ts does not export it, and package exports expose only mod.ts.
 */
export let writeSerialized: <K extends StoreKey>(
  store: FlashStore<K, unknown>,
  key: K,
  serialized: string,
) => Promise<void>

/** Use Map's zero equality; TypeScript represents both signs as the same numeric type. */
function normalizeKey<K extends StoreKey>(key: K): K {
  return Object.is(key, -0) ? (0 as K) : key
}

/** Reject ambiguous bounds before creating an LMDB cursor. */
function validateOptions<K extends StoreKey>(
  options: IteratorOptions<K>,
): void {
  if (options.prefix !== undefined && typeof options.prefix !== 'string') {
    throw new TypeError('prefix must be a string')
  }
  if (
    (options.gt !== undefined && options.gte !== undefined) ||
    (options.lt !== undefined && options.lte !== undefined) ||
    (options.prefix !== undefined &&
      (options.gt !== undefined ||
        options.gte !== undefined ||
        options.lt !== undefined ||
        options.lte !== undefined))
  ) {
    throw new TypeError('Conflicting range bounds')
  }
  if (
    options.limit !== undefined &&
    (!Number.isSafeInteger(options.limit) || options.limit < 0)
  ) {
    throw new RangeError('limit must be a non-negative safe integer')
  }
  for (const bound of [options.gt, options.gte, options.lt, options.lte]) {
    if (bound !== undefined) validateKey(bound)
  }
}

/**
 * Persistent key-value store. Values use JSON round-tripping, which may change their
 * runtime type; the generic value type does not validate or prevent this.
 */
export class FlashStore<K extends StoreKey = StoreKey, V = unknown> {
  static VERSION = VERSION
  readonly workdir: string
  private readonly db: RootDatabase<string, K>
  private readonly workdirLock: WorkdirLock
  private closePromise?: Promise<void>

  static {
    writeSerialized = (store, key, serialized) => store.write(key, serialized)
  }

  /** Opens an LMDB database in the specified directory. */
  constructor(workdir: string) {
    this.workdir = resolve(workdir)
    this.workdirLock = acquireWorkdirLock(this.workdir)
    try {
      this.db = open<string, K>({
        path: this.workdir,
        noSubdir: false,
        // Values are serialized once before writing, using LMDB's JSON byte format.
        encoding: 'string',
      })
    } catch (error) {
      releaseWorkdirLock(this.workdirLock)
      throw error
    }
    log.verbose('FlashStore', 'constructor(%s)', workdir)
  }

  /** Returns the package version. */
  version(): string {
    return VERSION
  }

  /** Stores a JSON-serializable value and resolves after its write completes. */
  async set(key: K, value: V): Promise<this> {
    validateKey(key)
    const serialized = serialize(value)
    log.verbose('FlashStore', 'set(%s, %s)', key, typeof value)
    await this.write(key, serialized)
    return this
  }

  /** Writes validated, serialized JSON and publishes the set event on success. */
  private async write(key: K, serialized: string): Promise<void> {
    log.silly('FlashStore', 'set(%s, %s)', key, serialized)
    await this.db.put(normalizeKey(key), serialized)
    if (operations.hasSubscribers) operations.publish({ operation: 'set' })
  }

  /** Returns the stored value, or undefined when the key is absent. */
  async get(key: K): Promise<V | undefined> {
    validateKey(key)
    log.verbose('FlashStore', 'get(%s)', key)
    const value = this.db.get(normalizeKey(key))
    return value === undefined ? undefined : JSON.parse(value)
  }

  /** Returns whether the key exists, including when its value is falsey. */
  async has(key: K): Promise<boolean> {
    validateKey(key)
    return this.db.doesExist(normalizeKey(key))
  }

  /** Deletes a key and reports whether an entry existed. */
  async delete(key: K): Promise<boolean> {
    validateKey(key)
    log.verbose('FlashStore', 'delete(%s)', key)
    // A plain remove() resolves true even for absent keys; IF_EXISTS makes LMDB
    // report this operation's own result, in order with other queued writes.
    const deleted = await this.db.remove(normalizeKey(key), IF_EXISTS)
    if (operations.hasSubscribers) operations.publish({ operation: 'delete' })
    return deleted
  }

  /** Removes every entry after queued writes. */
  async clear(): Promise<void> {
    log.verbose('FlashStore', 'clear()')
    await this.db.clearAsync()
    if (operations.hasSubscribers) operations.publish({ operation: 'clear' })
  }

  /** Resolves to the number of entries in the current snapshot. */
  get size(): Promise<number> {
    log.verbose('FlashStore', 'size()')
    return Promise.resolve().then(() => this.db.getCount())
  }

  /**
   * Iterates a snapshot in LMDB key order, releasing the cursor on early exit.
   * A prefix seeks to its contiguous key interval and stops on leaving it, so
   * the cost depends on matching entries rather than database size.
   */
  async *entries(
    options: IteratorOptions<K> = {},
  ): AsyncIterableIterator<[K, V]> {
    log.verbose('FlashStore', '*entries(%s)', JSON.stringify(options))
    validateOptions(options)
    if (options.limit === 0) return
    const reverse = options.reverse ?? false
    const lowerBound = options.gte ?? options.gt
    const upperBound = options.lte ?? options.lt
    const lower =
      lowerBound === undefined ? undefined : normalizeKey(lowerBound)
    const upper =
      upperBound === undefined ? undefined : normalizeKey(upperBound)
    const { prefix } = options
    const range =
      prefix === undefined
        ? {
            start: reverse ? upper : lower,
            end: reverse ? lower : upper,
            reverse,
            exclusiveStart: reverse
              ? options.lt !== undefined
              : options.gt !== undefined,
            inclusiveEnd: reverse
              ? options.gte !== undefined
              : options.lte !== undefined,
          }
        : reverse
          ? prefixRange(prefix)
          : { start: prefix }
    let count = 0
    for (const { key, value } of this.db.getRange(range)) {
      // Matching keys are contiguous, so the first mismatch ends the prefix.
      if (
        prefix !== undefined &&
        (typeof key !== 'string' || !key.startsWith(prefix))
      )
        break
      yield [key, JSON.parse(value)]
      if (++count === options.limit) break
    }
  }

  /** Iterates keys with the same range semantics as entries(). */
  async *keys(options: IteratorOptions<K> = {}): AsyncIterableIterator<K> {
    log.verbose('FlashStore', 'keys()')
    for await (const [key] of this.entries(options)) yield key
  }

  /** Iterates values with the same range semantics as entries(). */
  async *values(options: IteratorOptions<K> = {}): AsyncIterableIterator<V> {
    log.verbose('FlashStore', 'values()')
    for await (const [, value] of this.entries(options)) yield value
  }

  /** Returns the asynchronous entries iterator. */
  [Symbol.asyncIterator](): AsyncIterableIterator<[K, V]> {
    log.verbose('FlashStore', '*[Symbol.asyncIterator]()')
    return this.entries()
  }

  /** Awaits each callback in snapshot key order; stops and rejects on the first failure. */
  async forEach(
    callback: (value: V, key: K, store: this) => unknown,
    thisArg?: unknown,
  ): Promise<void> {
    log.verbose('FlashStore', 'forEach()')
    for await (const [key, value] of this)
      await callback.call(thisArg, value, key, this)
  }

  /** Closes the database after outstanding writes; repeated calls are safe. */
  async close(): Promise<void> {
    log.verbose('FlashStore', 'close()')
    this.closePromise ??= (async () => {
      try {
        await this.db.close()
      } finally {
        releaseWorkdirLock(this.workdirLock)
      }
    })()
    await this.closePromise
  }

  /** Closes and removes the entire database directory. Never pass a shared directory. */
  async destroy(): Promise<void> {
    log.verbose('FlashStore', 'destroy()')
    const protectedPaths = [
      parse(this.workdir).root,
      resolve(process.cwd()),
      resolve(tmpdir()),
      resolve(homedir()),
    ]
    if (protectedPaths.includes(this.workdir))
      throw new Error('Refusing to remove a protected directory')
    await this.close()
    await rm(this.workdir, { recursive: true, force: true })
  }
}

export default FlashStore
