/**
 * Shares the key-size contract between the universal and node builds. The
 * limit mirrors LMDB's default so both builds accept and reject the same keys.
 * LMDB-only key encoding lives in `./node/key-encoding.ts`.
 */
import type { StoreKey } from './flash-store-core.ts'

const maxKeyBytes = 1978
const encoder = new TextEncoder()

/** Rejects oversized keys before either backend or the write-back cache mutates. */
export function validateKeySize(key: StoreKey): void {
  // Each UTF-16 code unit needs at most three bytes, plus a possible lead byte.
  if (typeof key === 'string' && key.length * 3 + 1 > maxKeyBytes) {
    if (encoder.encode(key).length > maxKeyBytes)
      throw new RangeError('Key was too large')
  }
}
