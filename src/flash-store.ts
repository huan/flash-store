/**
 * Implements the asynchronous Map-like API over an LMDB environment.
 * It owns the database lifecycle; the synchronous facade builds on this API.
 */
import { channel } from 'node:diagnostics_channel'
import { rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { parse, resolve } from 'node:path'
import { open, type RootDatabase } from 'lmdb'
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

/** Reject keys that the configured ordered-binary encoding cannot represent safely. */
function validateKey(key: StoreKey): void {
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
  private closePromise?: Promise<void>

  /** Opens an LMDB database in the specified directory. */
  constructor(workdir: string) {
    this.workdir = resolve(workdir)
    this.db = open<string, K>({
      path: this.workdir,
      noSubdir: false,
      // Values are serialized once before writing, using LMDB's JSON byte format.
      encoding: 'string',
    })
    log.verbose('FlashStore', 'constructor(%s)', workdir)
  }

  /** Returns the package version. */
  version(): string {
    return VERSION
  }

  /** Stores a JSON-serializable value and resolves after its write completes. */
  async set(key: K, value: V): Promise<this> {
    validateKey(key)
    const serialized = JSON.stringify(value)
    if (serialized === undefined)
      throw new TypeError('Value must be JSON serializable')
    log.verbose('FlashStore', 'set(%s, %s)', key, typeof value)
    log.silly('FlashStore', 'set(%s, %s)', key, serialized)
    await this.db.put(normalizeKey(key), serialized)
    if (operations.hasSubscribers) operations.publish({ operation: 'set' })
    return this
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
    const normalizedKey = normalizeKey(key)
    const deleted = await this.db.transaction(() => {
      const exists = this.db.doesExist(normalizedKey)
      if (exists) this.db.removeSync(normalizedKey)
      return exists
    })
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

  /** Iterates a snapshot in LMDB key order, releasing the cursor on early exit. */
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
    const range = {
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
    let count = 0
    for (const { key, value } of this.db.getRange(range)) {
      if (
        options.prefix !== undefined &&
        (typeof key !== 'string' || !key.startsWith(options.prefix))
      )
        continue
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
    this.closePromise ??= this.db.close()
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
