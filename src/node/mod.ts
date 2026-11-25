/**
 * Node entry: the build selected by the `node` export condition (Node.js,
 * Deno, Bun). Persists to LMDB and may use native OS capabilities. It exports
 * the same names and public contract as `../mod.ts`.
 */
import { FlashStore } from './flash-store.ts'

export { log, VERSION } from '../config.ts'
export type { IteratorOptions, StoreKey } from './flash-store.ts'
export { FlashStore } from './flash-store.ts'
export { FlashStoreSync } from './flash-store-sync.ts'
export default FlashStore
