/**
 * Web-platform entry: the build selected for browsers, Workers, and any
 * runtime without a more specific `exports` condition. It needs IndexedDB and
 * throws a clear error where that is missing. It must not import
 * `node:*`, native addons, or `process`; native storage lives in `./node/`.
 * The Map facades share behavior with the node build through the shared core
 * and bind to an origin-scoped IndexedDB database here.
 */
import { FlashStoreCore, type StoreKey } from './flash-store-core.ts'
import { FlashStoreSyncCore } from './flash-store-sync-core.ts'
import { IndexedDbBackend } from './indexeddb-backend.ts'

export { log, VERSION } from './config.ts'
export type { IteratorOptions, StoreKey } from './flash-store-core.ts'
export { FlashStoreCore } from './flash-store-core.ts'
export { FlashStoreSyncCore } from './flash-store-sync-core.ts'

/** Persistent Map backed by IndexedDB with JSON-serialized values. */
export class FlashStore<
  K extends StoreKey = StoreKey,
  V = unknown,
> extends FlashStoreCore<K, V> {
  /** Starts opening the database. Each operation waits for it to be ready. */
  constructor(name: string) {
    super(name, new IndexedDbBackend(name))
  }
}

/** In-memory Map with ordered write-back to IndexedDB. */
export class FlashStoreSync<
  K extends StoreKey = StoreKey,
  V = unknown,
> extends FlashStoreSyncCore<K, V> {
  /** Starts restoring the named database. Await ready() before reading restored data. */
  constructor(name = '.flash-store-sync') {
    super(name, new FlashStore<K, V>(name))
  }
}

export default FlashStore
