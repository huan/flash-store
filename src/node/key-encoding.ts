/**
 * Encodes string prefixes into LMDB key bounds. It is node-only because the
 * bound's byte layout is specific to LMDB; the universal build uses IndexedDB
 * key ranges instead.
 */

const encoder = new TextEncoder()

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
