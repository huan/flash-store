/**
 * Implements durable browser storage over IndexedDB. Encoded keys preserve
 * LMDB ordering, and transaction ownership stays inside this backend so
 * awaiting an async iterator cannot leave an IndexedDB cursor inactive.
 */
import { readKey } from 'ordered-binary'
import type { StoreKey } from './flash-store-core.ts'
import { encodeKey, encodePrefixEnd } from './key-encoding.ts'
import type { ScanRange, StoreBackend, StoredEntry } from './store-backend.ts'

const records = 'records'

/** Decodes the keys written by this backend, including IndexedDB's ArrayBuffer output. */
function decode(key: IDBValidKey): StoreKey {
  const bytes = new Uint8Array(key as ArrayBuffer)
  return readKey(bytes, 0, bytes.length) as StoreKey
}

/** Returns a bounded IndexedDB range or null for an empty interval. */
function keyRange(range: ScanRange): IDBKeyRange | null | undefined {
  const lower = range.prefix ?? range.lower
  const start = lower === undefined ? undefined : encodeKey(lower)
  const end =
    range.prefix === undefined
      ? range.upper === undefined
        ? undefined
        : encodeKey(range.upper)
      : encodePrefixEnd(range.prefix)
  const upperOpen = range.prefix !== undefined || range.upperOpen
  if (start && end) {
    const order = indexedDB.cmp(start, end)
    if (order > 0 || (order === 0 && (range.lowerOpen || upperOpen)))
      return null
    return IDBKeyRange.bound(start, end, range.lowerOpen, upperOpen)
  }
  if (start) return IDBKeyRange.lowerBound(start, range.lowerOpen)
  if (end) return IDBKeyRange.upperBound(end, upperOpen)
}

/** Connects one browser store handle to an origin-scoped IndexedDB database. */
export class IndexedDbBackend implements StoreBackend {
  private readonly name: string
  private readonly connection: Promise<IDBDatabase>
  private readonly pending = new Set<Promise<unknown>>()
  private closing = false
  private invalidated = false

  /** Starts opening the database. Operations surface any open failure. */
  constructor(name: string) {
    this.name = `flash-store:${name}`
    this.connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(records)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          // A peer may upgrade or replace the database after this handle releases it.
          this.invalidated = true
          this.closing = true
          db.close()
        }
        db.onclose = () => {
          this.closing = true
        }
        resolve(db)
      }
    })
    // Construction stays synchronous, even if nothing consumes the connection.
    void this.connection.catch(() => {})
  }

  /** Runs a transaction and resolves only after its result has committed. */
  private transaction<T>(
    mode: IDBTransactionMode,
    schedule: (store: IDBObjectStore, result: (value: T) => void) => void,
  ): Promise<T> {
    if (this.closing)
      return Promise.reject(new Error('Store is closing or closed'))
    const operation = this.connection.then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(records, mode)
          let result: T
          tx.oncomplete = () => resolve(result)
          tx.onabort = () =>
            reject(tx.error ?? new Error('IndexedDB transaction aborted'))
          try {
            schedule(tx.objectStore(records), (value) => {
              result = value
            })
          } catch (error) {
            tx.abort()
            reject(error)
          }
        }),
    )
    this.pending.add(operation)
    const remove = () => this.pending.delete(operation)
    void operation.then(remove, remove)
    return operation
  }

  /** Reads one result from a readonly transaction. */
  private read<T>(
    request: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return this.transaction('readonly', (store, result) => {
      const read = request(store)
      read.onsuccess = () => result(read.result)
    })
  }

  /** Commits serialized JSON under the encoded key. */
  put(key: StoreKey, json: string): Promise<void> {
    return this.transaction('readwrite', (store, result) => {
      store.put(json, encodeKey(key))
      result(undefined)
    })
  }

  /** Reads stored JSON or returns undefined for a missing key. */
  get(key: StoreKey): Promise<string | undefined> {
    return this.read((store) => store.get(encodeKey(key)))
  }

  /** Reads presence without retrieving the value. */
  async has(key: StoreKey): Promise<boolean> {
    return (
      (await this.read((store) => store.getKey(encodeKey(key)))) !== undefined
    )
  }

  /** Checks existence and deletes atomically so concurrent callers get their own result. */
  delete(key: StoreKey): Promise<boolean> {
    return this.transaction('readwrite', (store, result) => {
      const bytes = encodeKey(key)
      const request = store.getKey(bytes)
      request.onsuccess = () => {
        const exists = request.result !== undefined
        if (exists) store.delete(bytes)
        result(exists)
      }
    })
  }

  /** Removes all records atomically. */
  clear(): Promise<void> {
    return this.transaction('readwrite', (store, result) => {
      store.clear()
      result(undefined)
    })
  }

  /** Counts records without reading their values. */
  count(): Promise<number> {
    return this.read((store) => store.count())
  }

  /** Collects the matching snapshot before returning control to the consumer. */
  async scan(range: ScanRange): Promise<StoredEntry[]> {
    return this.transaction('readonly', (store, result) => {
      const bounds = keyRange(range)
      const entries: StoredEntry[] = []
      result(entries)
      if (bounds === null) return
      const request = store.openCursor(bounds, range.reverse ? 'prev' : 'next')
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const key = decode(cursor.key)
        if (
          range.prefix !== undefined &&
          (typeof key !== 'string' || !key.startsWith(range.prefix))
        )
          return
        entries.push({ key, value: cursor.value })
        if (entries.length !== range.limit) cursor.continue()
      }
    })
  }

  /** Prevents new work and closes after all already submitted transactions settle. */
  async close(): Promise<void> {
    this.closing = true
    await Promise.allSettled(this.pending)
    const db = await this.connection
    db.close()
  }

  /** Deletes by name after close, rejecting handles invalidated by a version change. */
  async destroy(): Promise<void> {
    if (this.invalidated)
      throw new Error(
        'Store was closed for an external database version change',
      )
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
