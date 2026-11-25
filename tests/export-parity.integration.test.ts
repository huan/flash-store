/**
 * Validates strict typing and runtime export shape parity between the
 * web-platform entry (`src/mod.ts`) and native Node entry (`src/node/mod.ts`).
 *
 * Why it exists: `package.json#exports` publishes a single declaration entry
 * (`dist/src/mod.d.ts`), meaning all consumers are typed against the Web build.
 * If the runtime exports, prototype methods, or constructors in `src/node/mod.ts`
 * drift from `src/mod.ts`, consumers would face runtime errors unflagged by
 * TypeScript. This test guarantees compile-time and runtime parity.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as Web from '../src/mod.ts'
import * as Node from '../src/node/mod.ts'

/* ------------------------------------------------------------------ */
/* Compile-time Type Parity Proofs                                    */
/* ------------------------------------------------------------------ */

/** Evaluates to true if and only if X and Y are identical types in TypeScript. */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false

/** Triggers TS2344 compile error if evaluated type is not true. */
type AssertTrue<T extends true> = T

// 1. Module-level strict type equality
export type _TestModuleStrictEquals = AssertTrue<
  Equals<typeof Web, typeof Node>
>

// 2. Class constructor signatures
export type _TestFlashStoreCtorEquals = AssertTrue<
  Equals<typeof Web.FlashStore, typeof Node.FlashStore>
>
export type _TestFlashStoreSyncCtorEquals = AssertTrue<
  Equals<typeof Web.FlashStoreSync, typeof Node.FlashStoreSync>
>

// 3. Generic instance structural compatibility
export type _TestFlashStoreInstanceEquals = AssertTrue<
  Equals<Web.FlashStore<string, number>, Node.FlashStore<string, number>>
>
export type _TestFlashStoreSyncInstanceEquals = AssertTrue<
  Equals<
    Web.FlashStoreSync<string, number>,
    Node.FlashStoreSync<string, number>
  >
>

// 4. Exported type options and keys
export type _TestIteratorOptionsEquals = AssertTrue<
  Equals<Web.IteratorOptions<string>, Node.IteratorOptions<string>>
>
export type _TestStoreKeyEquals = AssertTrue<
  Equals<Web.StoreKey, Node.StoreKey>
>

/* ------------------------------------------------------------------ */
/* Runtime Export & Prototype Parity Tests                            */
/* ------------------------------------------------------------------ */

describe('Web and Node build export parity', () => {
  test('named exports and default export match strictly', () => {
    // Both entries must export the exact same set of symbols
    assert.deepEqual(
      Object.keys(Web).sort(),
      Object.keys(Node).sort(),
      'Web and Node entries must export the identical keys',
    )

    // Default exports both map to FlashStore
    assert.equal(Web.default, Web.FlashStore)
    assert.equal(Node.default, Node.FlashStore)

    // Shared base classes are the exact same singletons
    assert.equal(Web.FlashStoreCore, Node.FlashStoreCore)
    assert.equal(Web.FlashStoreSyncCore, Node.FlashStoreSyncCore)

    // Version metadata matches
    assert.equal(Web.VERSION, Node.VERSION)
    assert.equal(Web.FlashStore.VERSION, Node.FlashStore.VERSION)
    assert.equal(Web.FlashStoreSync.VERSION, Node.FlashStoreSync.VERSION)
  })

  test('public prototype API contracts match across prototype chains', () => {
    /**
     * Traverses the prototype chain to collect all method and accessor names
     * using descriptors so getters (like `size`) are not invoked prematurely.
     */
    function getPublicApi(cls: { prototype: object }): string[] {
      const members = new Set<string>()
      let proto = cls.prototype
      while (proto && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
          const desc = Object.getOwnPropertyDescriptor(proto, name)
          if (desc && (typeof desc.value === 'function' || desc.get)) {
            members.add(name)
          }
        }
        proto = Object.getPrototypeOf(proto)
      }
      return [...members].sort()
    }

    assert.deepEqual(
      getPublicApi(Web.FlashStore),
      getPublicApi(Node.FlashStore),
      'FlashStore public prototype API must be identical between Web and Node',
    )

    assert.deepEqual(
      getPublicApi(Web.FlashStoreSync),
      getPublicApi(Node.FlashStoreSync),
      'FlashStoreSync public prototype API must be identical between Web and Node',
    )
  })
})
