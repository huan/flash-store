/**
 * Shares the default LMDB key-size limit and string prefix bounding for LMDB.
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

/** Returns an exclusive bound for a nonempty encoded string prefix for LMDB. */
export function encodePrefixEnd(
  prefix: string,
): Uint8Array<ArrayBuffer> | undefined {
  if (prefix === '') return undefined
  const bytes = encoder.encode(prefix)
  // An encoded UTF-8 string ends in an ASCII or continuation byte (none is 255).
  // Advancing the byte keeps the bound within the key limit.
  const last = bytes.length - 1
  bytes[last] = (bytes[last] ?? 0) + 1
  return bytes
}
