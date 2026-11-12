/**
 * Defines the public ESM entry point for the persistent and cached store APIs.
 */
import { FlashStore } from './flash-store.ts'

export { log, VERSION } from './config.ts'
export type { IteratorOptions, StoreKey } from './flash-store.ts'
export { FlashStore } from './flash-store.ts'
export { FlashStoreSync } from './flash-store-sync.ts'
export default FlashStore
