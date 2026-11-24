/**
 * Runs the synchronous write-back cache contract against each runtime's store.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FlashStore, FlashStoreSync } from '#test-store'
import type { StoreBackend } from './store-backend.ts'
import { testStore } from './test-fixture.ts'

/** Inject a rejected write at the shared storage boundary. */
function failWrites(store: FlashStoreSync<string, unknown>): void {
  const backing: FlashStore<string, unknown> = Reflect.get(store, 'flashStore')
  const backend: StoreBackend = Reflect.get(backing, 'backend')
  backend.put = () => Promise.reject(new Error('write failed'))
}

test('loads existing data without overwriting immediate mutations', async (t) => {
  const { open, openSync } = testStore(t)
  const initial = open<string, number>()
  await initial.set('a', 1)
  await initial.set('b', 2)
  await initial.close()
  const store = openSync<string, number>()
  store.set('a', 3)
  store.delete('b')
  store.set('c', 4)
  await store.ready()
  assert.equal(store.get('a'), 3)
  assert.equal(store.has('b'), false)
  assert.equal(store.size, 2)
  await store.close()
  const reopened = open<string, number>()
  assert.deepEqual(await Array.fromAsync(reopened.entries()), [
    ['a', 3],
    ['c', 4],
  ])
  await reopened.destroy()
})

test('clear during initialization and destroy wait for queued writes', async (t) => {
  const { open, openSync } = testStore(t)
  const initial = open<string, number>()
  await initial.set('old', 1)
  await initial.close()
  const store = openSync<string, number>()
  store.clear()
  store.set('new', 2)
  await store.ready()
  assert.deepEqual([...store.entries()], [['new', 2]])
  await store.destroy()
})

test('persists and restores zero keys with Map equality', async (t) => {
  const { open, openSync } = testStore(t)
  const store = openSync<number, string>()
  store.set(-0, 'zero')
  await store.ready()
  await store.close()
  const reopened = openSync<number, string>()
  await reopened.ready()
  assert.equal(reopened.get(0), 'zero')
  assert.equal(reopened.get(-0), 'zero')
  assert.deepEqual([...reopened.keys()], [0])
  assert.equal(reopened.delete(-0), true)
  await reopened.ready()
  await reopened.close()
  const backing = open<number, string>()
  assert.equal(await backing.has(0), false)
  await backing.destroy()
})

test('persists values as serialized when set and rejects invalid input synchronously', async (t) => {
  const { open, openSync } = testStore(t)
  const store = openSync<string | number, unknown>()
  const value = { count: 1 }
  store.set('first', value)
  value.count = 2
  store.set('second', value)
  assert.throws(() => store.set('bad', undefined), /JSON serializable/)
  assert.throws(() => store.set('bad\0key', 1), /Keys/)
  assert.throws(() => store.delete(Number.NaN), /Keys/)
  assert.equal(store.has('bad'), false)
  await store.ready()
  await store.close()
  const reopened = open<string, unknown>()
  assert.deepEqual(await Array.fromAsync(reopened.entries()), [
    ['first', { count: 1 }],
    ['second', { count: 2 }],
  ])
  await reopened.destroy()
})

test('write failures surface through ready and close', async (t) => {
  const { open, openSync } = testStore(t)
  const store = openSync<string, unknown>()
  await store.ready()
  failWrites(store)
  store.set('bad', 1)
  store.set('queued', 1)
  await assert.rejects(store.ready(), /write failed/)
  assert.throws(() => store.set('good', 1), /write failed/)
  assert.throws(() => store.delete('bad'), /write failed/)
  assert.throws(() => store.clear(), /write failed/)
  assert.equal(store.has('good'), false)
  await assert.rejects(store.close(), /write failed/)
  const reopened = open<string, unknown>()
  assert.equal(await reopened.get('bad'), undefined)
  assert.equal(await reopened.get('queued'), undefined)
  await reopened.destroy()
})

test('destroy closes the backing store after a write failure without deleting data', async (t) => {
  const { open, openSync } = testStore(t)
  const store = openSync<string, unknown>()
  store.set('saved', 1)
  await store.ready()
  failWrites(store)
  store.set('bad', 1)
  await assert.rejects(store.destroy(), /write failed/)
  const backing: FlashStore<string, unknown> = Reflect.get(store, 'flashStore')
  await assert.rejects(backing.get('saved'), /closed/i)
  const reopened = open<string, unknown>()
  assert.equal(await reopened.get('saved'), 1)
  await reopened.destroy()
})

test('close preserves both write and close failures', async (t) => {
  const { openSync } = testStore(t)
  const store = openSync<string, unknown>()
  const backing: FlashStore<string, unknown> = Reflect.get(store, 'flashStore')
  const close = backing.close.bind(backing)
  backing.close = async () => {
    throw new Error('close failed')
  }
  try {
    await store.ready()
    failWrites(store)
    store.set('bad', 1)
    await assert.rejects(store.close(), (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.errors[0].message, /write failed/)
      assert.match(error.errors[1].message, /close failed/)
      return true
    })
  } finally {
    backing.close = close
    await close()
  }
})

test('Map operations reflect cached data and queue persistence', async (t) => {
  const { open, openSync } = testStore(t)
  const store = openSync<string, number>()
  await store.ready()
  store.set('a', 1).set('b', 2)
  assert.equal(store.getOrInsert('a', 100), 1)
  assert.equal(
    store.getOrInsertComputed('b', () => 100),
    2,
  )
  assert.equal(store.getOrInsert('c', 3), 3)
  assert.equal(
    store.getOrInsertComputed('d', () => 4),
    4,
  )
  assert.deepEqual([...store.keys()], ['a', 'b', 'c', 'd'])
  assert.deepEqual([...store.values()], [1, 2, 3, 4])
  assert.deepEqual(
    [...store],
    [
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ],
  )
  const seen: string[] = []
  store.forEach((value, key, map) => {
    assert.equal(map, store)
    seen.push(`${key}:${value}`)
  })
  assert.deepEqual(seen, ['a:1', 'b:2', 'c:3', 'd:4'])
  assert.equal(store.delete('a'), true)
  await store.close()
  assert.throws(() => store.set('c', 3), /closing/)
  const reopened = open<string, number>()
  assert.deepEqual(await Array.fromAsync(reopened.entries()), [
    ['b', 2],
    ['c', 3],
    ['d', 4],
  ])
  await reopened.destroy()
})
