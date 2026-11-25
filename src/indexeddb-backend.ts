/**
 * Implements durable browser storage over IndexedDB using native keys.
 * Transaction ownership stays inside this backend so awaiting an async
 * iterator cannot leave an IndexedDB cursor inactive.
 */
import type { StoreKey } from './flash-store-core.ts'
import type { ScanRange, StoreBackend, StoredEntry } from './store-backend.ts'

const records = 'records'

/** Returns the next string strictly greater than any string with the given prefix. */
function prefixEnd(prefix: string): string | undefined {
  if (prefix === '') return undefined
  let i = prefix.length - 1
  while (i >= 0 && prefix.charCodeAt(i) === 0xffff) i--
  if (i < 0) return undefined
  return prefix.slice(0, i) + String.fromCharCode(prefix.charCodeAt(i) + 1)
}

/** Returns a bounded IndexedDB range or null for an empty interval. */
function keyRange(range: ScanRange): IDBKeyRange | null | undefined {
  const isPrefix = range.prefix !== undefined
  const start = range.prefix !== undefined ? range.prefix : range.lower
  const end = range.prefix !== undefined ? prefixEnd(range.prefix) : range.upper
  const lowerOpen = isPrefix ? false : range.lowerOpen
  const upperOpen = isPrefix ? end !== undefined : range.upperOpen

  if (start !== undefined && end !== undefined) {
    const order = indexedDB.cmp(start, end)
    if (order > 0 || (order === 0 && (lowerOpen || upperOpen))) return null
    return IDBKeyRange.bound(start, end, lowerOpen, upperOpen)
  }
  if (start !== undefined) return IDBKeyRange.lowerBound(start, lowerOpen)
  if (end !== undefined) return IDBKeyRange.upperBound(end, upperOpen)
  return undefined
}

/** Connects one browser store handle to an origin-scoped IndexedDB database. */
export class IndexedDbBackend implements StoreBackend {
  private readonly name: string
  private readonly connection: Promise<IDBDatabase>
  private readonly pending = new Set<Promise<unknown>>()
  private closing = false
  private invalidated = false

  /**
   * Starts opening the database. Operations surface any open failure.
   * Throws immediately when the runtime has no IndexedDB: the web build
   * cannot persist there, and failing loudly beats silently losing data.
   */
  constructor(name: string) {
    if (typeof indexedDB === 'undefined')
      throw new Error(
        'FlashStore: IndexedDB is not available in this runtime, so the web build cannot persist data. ' +
          "Use a browser, or run on Node.js, Deno, or Bun and import 'flash-store' (or 'flash-store/node').",
      )
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
          let requestError: DOMException | Error | null = null
          tx.oncomplete = () => resolve(result)
          tx.onerror = (event) => {
            // Cancel the default action so unhandled errors do not bubble to window.
            event.preventDefault()
            requestError =
              (event.target as IDBRequest | null)?.error ??
              tx.error ??
              new Error('IndexedDB transaction failed')
            try {
              tx.abort()
            } catch {
              // Transaction may already be aborting or aborted.
            }
          }
          tx.onabort = () =>
            reject(
              requestError ??
                tx.error ??
                new Error('IndexedDB transaction aborted'),
            )
          try {
            schedule(tx.objectStore(records), (value) => {
              result = value
            })
          } catch (error) {
            try {
              tx.abort()
            } catch {
              // Transaction may already be aborting or aborted.
            }
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

  /** Commits serialized JSON under the key. */
  put(key: StoreKey, json: string): Promise<void> {
    return this.transaction('readwrite', (store, result) => {
      store.put(json, key)
      result(undefined)
    })
  }

  /** Reads stored JSON or returns undefined for a missing key. */
  get(key: StoreKey): Promise<string | undefined> {
    return this.read((store) => store.get(key))
  }

  /** Reads presence without retrieving the value. */
  async has(key: StoreKey): Promise<boolean> {
    return (await this.read((store) => store.getKey(key))) !== undefined
  }

  /** Checks existence and deletes atomically so concurrent callers get their own result. */
  delete(key: StoreKey): Promise<boolean> {
    return this.transaction('readwrite', (store, result) => {
      const request = store.getKey(key)
      request.onsuccess = () => {
        const exists = request.result !== undefined
        if (exists) store.delete(key)
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
        const key = cursor.key as StoreKey
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
    try {
      const db = await this.connection
      db.close()
    } catch {
      // If opening the database failed, it is already closed.
    }
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
