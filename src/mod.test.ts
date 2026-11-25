/**
 * Verifies the web-platform entry fails loudly where it cannot persist. It hides
 * `indexedDB` instead of depending on the runtime, so the same case runs under
 * Node.js, Deno, and Chromium.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FlashStore, FlashStoreSync } from './mod.ts'

/** Hides the global IndexedDB for one test and restores the original descriptor. */
function withoutIndexedDb(t: { after(fn: () => void): void }): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'indexedDB', {
    value: undefined,
    configurable: true,
    writable: true,
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  })
}

test('FlashStore throws a message naming the fix when IndexedDB is missing', (t) => {
  withoutIndexedDb(t)
  assert.throws(
    () => new FlashStore('missing-capability'),
    /IndexedDB is not available.*flash-store\/node/s,
  )
})

test('FlashStoreSync surfaces the same error instead of degrading to memory', (t) => {
  withoutIndexedDb(t)
  assert.throws(
    () => new FlashStoreSync('missing-capability'),
    /IndexedDB is not available/,
  )
})
