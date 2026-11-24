/**
 * Describes the serialized storage contract between the shared Map API and
 * LMDB or IndexedDB. Backends own resource lifetimes and transaction boundaries.
 */
import type { StoreKey } from './flash-store-core.ts'

/** A normalized scan. A string prefix is mutually exclusive with explicit bounds. */
export interface ScanRange {
  lower?: StoreKey
  upper?: StoreKey
  lowerOpen: boolean
  upperOpen: boolean
  reverse: boolean
  prefix?: string
  limit?: number
}

/** A record whose value is already serialized. */
export interface StoredEntry {
  key: StoreKey
  value: string
}

/** Internal storage operations. Writes resolve once the backend commits them. */
export interface StoreBackend {
  put(key: StoreKey, json: string): Promise<unknown>
  get(key: StoreKey): string | undefined | Promise<string | undefined>
  has(key: StoreKey): boolean | Promise<boolean>
  delete(key: StoreKey): Promise<boolean>
  clear(): Promise<void>
  /** Starts a count on the current read snapshot before returning its promise. */
  count(): Promise<number>
  scan(range: ScanRange): Iterable<StoredEntry> | Promise<Iterable<StoredEntry>>
  close(): Promise<void>
  destroy(): Promise<void>
  publish?(operation: 'set' | 'delete' | 'clear'): void
}
