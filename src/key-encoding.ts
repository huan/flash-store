/**
 * Shares the default LMDB key-size limit and ordered-binary representation.
 * The browser uses the encoded keys for IndexedDB's bytewise range ordering.
 */
import { writeKey } from 'ordered-binary'
import type { StoreKey } from './flash-store-core.ts'

const maxKeyBytes = 1978
const keyBuffer = new Uint8Array(maxKeyBytes + 10)

/** Returns the encoded size or rejects a key beyond the default LMDB limit. */
function checkedSize(key: StoreKey): number {
  let size: number
  try {
    size = writeKey(key, keyBuffer, 0)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    throw new RangeError('Key was too large', { cause: error })
  }
  if (size > maxKeyBytes) throw new RangeError('Key was too large')
  return size
}

/** Copies the encoded bytes before another operation reuses the buffer. */
export function encodeKey(key: StoreKey): Uint8Array<ArrayBuffer> {
  return keyBuffer.slice(0, checkedSize(key))
}

/** Rejects oversized native writes before LMDB can start a write batch. */
export function checkNativeWriteKey(key: StoreKey): void {
  // Each UTF-16 code unit needs at most three bytes, plus a possible lead byte.
  if (typeof key === 'string' && key.length * 3 + 1 > maxKeyBytes)
    checkedSize(key)
}

/** Returns an exclusive bound for a nonempty encoded string prefix. */
export function encodePrefixEnd(
  prefix: string,
): Uint8Array<ArrayBuffer> | undefined {
  if (prefix === '') return undefined
  const bytes = encodeKey(prefix)
  // An encoded string ends in an ASCII, UTF-8, or escaped control byte.
  // None can be 255. Advancing the byte keeps the bound within the key limit
  // even when the next Unicode character would need more bytes.
  const last = bytes.length - 1
  const view = new DataView(bytes.buffer)
  view.setUint8(last, view.getUint8(last) + 1)
  return bytes
}
