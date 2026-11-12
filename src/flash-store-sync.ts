/**
 * Provides a synchronous in-memory Map facade with ordered asynchronous write-back.
 * FlashStore owns persistence; ready() is the boundary for observing write failures.
 * Keys and values are validated and serialized when a mutation is accepted, so
 * invalid input throws synchronously and later object changes are not persisted.
 */

import { log } from './config.ts'
import {
  FlashStore,
  type StoreKey,
  serialize,
  validateKey,
  writeSerialized,
} from './flash-store.ts'

/**
 * In-memory Map backed by asynchronous LMDB writes.
 * Await ready() before reading restored data; detected write failures reject further mutations.
 * Restored entries follow LMDB key order rather than their original insertion order.
 */
export class FlashStoreSync<K extends StoreKey = StoreKey, V = unknown>
  implements Map<K, V>
{
  static VERSION = FlashStore.VERSION
  readonly workdir: string
  private readonly cacheMap = new Map<K, V>()
  private readonly flashStore: FlashStore<K, V>
  private readonly touched = new Set<K>()
  private loading = true
  private clearedDuringLoad = false
  private pending: Promise<void>
  private closing = false
  private failure?: { error: unknown }

  /** Opens the backing store and starts restoring its cache. */
  constructor(workdir = '.flash-store-sync') {
    log.verbose('CacheStore', 'constructor(%s)', workdir)
    this.workdir = workdir
    this.flashStore = new FlashStore<K, V>(workdir)
    this.pending = this.load()
    this.observeFailure()
  }

  /** Restore untouched keys while immediate cache mutations remain authoritative. */
  private async load(): Promise<void> {
    try {
      for await (const [key, value] of this.flashStore) {
        if (!this.clearedDuringLoad && !this.touched.has(key))
          this.cacheMap.set(key, value)
      }
    } finally {
      this.loading = false
      this.touched.clear()
    }
  }

  /** Serialize writes behind initialization; reject mutations after a detected failure. */
  private enqueue(action: () => Promise<unknown>): void {
    if (this.closing) throw new Error('Store is closing or closed')
    if (this.failure) throw this.failure.error
    this.pending = this.pending.then(async () => {
      await action()
    })
    this.observeFailure()
  }

  /** Report background errors once while retaining the rejection for lifecycle calls. */
  private observeFailure(): void {
    void this.pending.catch((error: unknown) => {
      if (!this.failure) {
        this.failure = { error }
        log.error('CacheStore', 'Background operation failed: %s', error)
      }
    })
  }

  /** Returns the package version. */
  version(): string {
    return this.flashStore.version()
  }

  /** Waits for initialization and writes queued before this call, rejecting on failure. */
  async ready(): Promise<void> {
    await this.pending
  }

  /** Waits for writes and closes the backing store, preserving write and close failures. */
  async close(): Promise<void> {
    this.closing = true
    try {
      await this.ready()
    } catch (error) {
      try {
        await this.flashStore.close()
      } catch (closeError) {
        throw new AggregateError([error, closeError], 'Write and close failed')
      }
      throw error
    }
    await this.flashStore.close()
  }

  /** Closes even on write failure; removes the directory only after successful writes. */
  async destroy(): Promise<void> {
    await this.close()
    await this.flashStore.destroy()
  }

  /** Returns the current number of cached entries. */
  get size(): number {
    return this.cacheMap.size
  }

  /** Identifies this object as a Map. */
  get [Symbol.toStringTag](): string {
    return 'Map'
  }

  /** Iterates cached entries in insertion order. */
  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.cacheMap[Symbol.iterator]()
  }

  /** Iterates cached entries in insertion order. */
  entries(): MapIterator<[K, V]> {
    return this.cacheMap.entries()
  }

  /** Iterates cached keys in insertion order. */
  keys(): MapIterator<K> {
    return this.cacheMap.keys()
  }

  /** Iterates cached values in insertion order. */
  values(): MapIterator<V> {
    return this.cacheMap.values()
  }

  /** Clears the cache immediately and queues persistent removal. */
  clear(): void {
    this.enqueue(() => this.flashStore.clear())
    if (this.loading) this.clearedDuringLoad = true
    this.cacheMap.clear()
  }

  /** Removes a cached entry immediately and queues persistent removal. */
  delete(key: K): boolean {
    validateKey(key)
    this.enqueue(() => this.flashStore.delete(key))
    if (this.loading) this.touched.add(key)
    return this.cacheMap.delete(key)
  }

  /** Invokes the callback for each cached entry. */
  forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.cacheMap)
      callbackfn.call(thisArg, value, key, this)
  }

  /** Reads a cached value; await ready() first to include previously persisted data. */
  get(key: K): V | undefined {
    return this.cacheMap.get(key)
  }

  /** Checks the cache; await ready() first to include previously persisted data. */
  has(key: K): boolean {
    return this.cacheMap.has(key)
  }

  /** Returns a cached value or inserts and queues the supplied default. */
  getOrInsert(key: K, defaultValue: V): V {
    if (this.cacheMap.has(key)) return this.cacheMap.get(key) as V
    this.set(key, defaultValue)
    return defaultValue
  }

  /** Returns a cached value or computes, inserts, and queues a new value. */
  getOrInsertComputed(key: K, callback: (key: K) => V): V {
    if (this.cacheMap.has(key)) return this.cacheMap.get(key) as V
    const value = callback(key)
    this.set(key, value)
    return value
  }

  /**
   * Updates the cache immediately and queues an ordered persistent write of the
   * value's JSON at call time. Throws without changes for invalid keys or values.
   */
  set(key: K, value: V): this {
    validateKey(key)
    const serialized = serialize(value)
    this.enqueue(() => writeSerialized(this.flashStore, key, serialized))
    if (this.loading) this.touched.add(key)
    this.cacheMap.set(key, value)
    return this
  }
}

export default FlashStoreSync
