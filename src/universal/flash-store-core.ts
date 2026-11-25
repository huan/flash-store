/**
 * Owns the async Map API, validation, and JSON encoding shared by the server
 * and universal entries. Its storage backend supplies transactions and snapshots.
 */
import { log, VERSION } from './config.ts'
import { validateKeySize } from './key-encoding.ts'
import type { ScanRange, StoreBackend } from './store-backend.ts'

/** Numbers precede strings in storage key order. */
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

/** Reject keys outside the serialized storage contract. */
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
  validateKeySize(key)
}

/** Serialize a value once, rejecting values that JSON cannot represent. */
export function serialize(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined)
    throw new TypeError('Value must be JSON serializable')
  return serialized
}

/**
 * Writes pre-serialized JSON for FlashStoreSync, which serializes at call time.
 * Used by the shared synchronous cache, outside the public package entries.
 */
export let writeSerialized: <K extends StoreKey>(
  store: FlashStoreCore<K, unknown>,
  key: K,
  serialized: string,
) => Promise<void>

/** Use Map's zero equality; TypeScript represents both signs as the same numeric type. */
function normalizeKey<K extends StoreKey>(key: K): K {
  return Object.is(key, -0) ? (0 as K) : key
}

/** Reject ambiguous bounds before starting a storage scan. */
function validateOptions<K extends StoreKey>(
  options: IteratorOptions<K>,
): void {
  if (options.prefix !== undefined) {
    if (typeof options.prefix !== 'string') {
      throw new TypeError('prefix must be a string')
    }
    validateKey(options.prefix)
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

/** Shared Map API for the installed runtime-specific entries. */
export class FlashStoreCore<K extends StoreKey, V> {
  static VERSION = VERSION
  readonly workdir: string
  private readonly backend: StoreBackend
  private closePromise?: Promise<void>
  private destroyPromise?: Promise<void>

  static {
    writeSerialized = (store, key, serialized) => store.write(key, serialized)
  }

  /** Binds a storage backend and exposes its location through the public workdir property. */
  protected constructor(
    workdir: string,
    backend: StoreBackend,
    requested = workdir,
  ) {
    this.workdir = workdir
    this.backend = backend
    log.verbose('FlashStore', 'constructor(%s)', requested)
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
    await this.backend.put(normalizeKey(key), serialized)
    this.backend.publish?.('set')
  }

  /** Returns the stored value, or undefined when the key is absent. */
  async get(key: K): Promise<V | undefined> {
    validateKey(key)
    log.verbose('FlashStore', 'get(%s)', key)
    const value = await this.backend.get(normalizeKey(key))
    return value === undefined ? undefined : JSON.parse(value)
  }

  /** Returns whether the key exists, including when its value is falsey. */
  async has(key: K): Promise<boolean> {
    validateKey(key)
    return this.backend.has(normalizeKey(key))
  }

  /** Deletes a key and reports whether an entry existed. */
  async delete(key: K): Promise<boolean> {
    validateKey(key)
    log.verbose('FlashStore', 'delete(%s)', key)
    const deleted = await this.backend.delete(normalizeKey(key))
    this.backend.publish?.('delete')
    return deleted
  }

  /** Removes every entry after queued writes. */
  async clear(): Promise<void> {
    log.verbose('FlashStore', 'clear()')
    await this.backend.clear()
    this.backend.publish?.('clear')
  }

  /** Starts counting immediately and resolves to the size of that read snapshot. */
  get size(): Promise<number> {
    log.verbose('FlashStore', 'size()')
    return this.backend.count()
  }

  /** Iterates a snapshot in storage key order and releases it on early exit. */
  async *entries(
    options: IteratorOptions<K> = {},
  ): AsyncIterableIterator<[K, V]> {
    log.verbose('FlashStore', '*entries(%s)', JSON.stringify(options))
    validateOptions(options)
    if (options.limit === 0) return
    const lower = options.gte ?? options.gt
    const upper = options.lte ?? options.lt
    const range: ScanRange = {
      lower: lower === undefined ? undefined : normalizeKey(lower),
      upper: upper === undefined ? undefined : normalizeKey(upper),
      lowerOpen: options.gt !== undefined,
      upperOpen: options.lt !== undefined,
      reverse: options.reverse ?? false,
      prefix: options.prefix,
      limit: options.limit,
    }
    // Native LMDB provides a synchronous cursor. Chromium finishes its read
    // transaction before yielding so consumer awaits cannot invalidate it.
    const entries = this.backend.scan(range)
    for (const { key, value } of entries instanceof Promise
      ? await entries
      : entries)
      yield [key as K, JSON.parse(value)]
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
    try {
      this.closePromise ??= this.backend.close()
      await this.closePromise
    } catch (error) {
      this.closePromise = undefined
      throw error
    }
  }

  /** Closes this handle and removes its backing storage once. Failed removals can be retried. */
  async destroy(): Promise<void> {
    log.verbose('FlashStore', 'destroy()')
    this.destroyPromise ??= this.removeStorage()
    await this.destroyPromise
  }

  /** Releases the handle before removal and leaves failures available for retry. */
  private async removeStorage(): Promise<void> {
    try {
      await this.close()
      await this.backend.destroy()
    } catch (error) {
      this.destroyPromise = undefined
      throw error
    }
  }
}
