/**
 * Gives portable test cases isolated storage and closes their handles before
 * teardown. The test runner resolves the same public API to its own runtime.
 */

import type { TestContext } from 'node:test'
import { FlashStore, FlashStoreSync, type StoreKey } from '#test-store'

/** Provides independent handles to one freshly named test store. */
export function testStore(t: TestContext) {
  const location = `t/flash-store-test-${crypto.randomUUID()}`
  const handles: { close(): Promise<void> }[] = []

  t.after(async () => {
    await Promise.allSettled(handles.map((handle) => handle.close()))
    await new FlashStore(location).destroy()
  })

  return {
    /** Opens the async store on this fixture's location. */
    open<K extends StoreKey = StoreKey, V = unknown>(): FlashStore<K, V> {
      const store = new FlashStore<K, V>(location)
      handles.push(store)
      return store
    },
    /** Opens a write-back cache on the same location. */
    openSync<K extends StoreKey = StoreKey, V = unknown>(): FlashStoreSync<
      K,
      V
    > {
      const store = new FlashStoreSync<K, V>(location)
      handles.push(store)
      return store
    },
  }
}
