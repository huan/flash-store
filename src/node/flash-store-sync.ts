/**
 * Binds the shared synchronous Map cache to the native LMDB-backed store.
 */

import { FlashStoreSyncCore } from '../flash-store-sync-core.ts'
import { FlashStore, type StoreKey } from './flash-store.ts'

/** In-memory Map with ordered write-back to LMDB. */
export class FlashStoreSync<
  K extends StoreKey = StoreKey,
  V = unknown,
> extends FlashStoreSyncCore<K, V> {
  /** Opens the backing path and starts restoring its cache. Await ready() before reading restored data. */
  constructor(workdir = '.flash-store-sync') {
    super(workdir, new FlashStore<K, V>(workdir))
  }
}

export default FlashStoreSync
