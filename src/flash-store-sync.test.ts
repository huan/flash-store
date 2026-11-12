/**
 * Verifies the cache facade's initialization, ordered write-back, and error boundary.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FlashStore } from './flash-store.ts'
import { FlashStoreSync } from './flash-store-sync.ts'

test('loads existing data without overwriting immediate mutations', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const initial = new FlashStore<string, number>(dir)
  await initial.set('a', 1)
  await initial.set('b', 2)
  await initial.close()
  const store = new FlashStoreSync<string, number>(dir)
  store.set('a', 3)
  store.delete('b')
  store.set('c', 4)
  await store.ready()
  assert.equal(store.get('a'), 3)
  assert.equal(store.has('b'), false)
  assert.equal(store.size, 2)
  await store.close()
  const reopened = new FlashStore<string, number>(dir)
  assert.deepEqual(await Array.fromAsync(reopened.entries()), [
    ['a', 3],
    ['c', 4],
  ])
  await reopened.destroy()
})

test('clear during initialization and destroy wait for queued writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const initial = new FlashStore<string, number>(dir)
  await initial.set('old', 1)
  await initial.close()
  const store = new FlashStoreSync<string, number>(dir)
  store.clear()
  store.set('new', 2)
  await store.ready()
  assert.deepEqual([...store.entries()], [['new', 2]])
  await store.destroy()
})

test('persists and restores zero keys with Map equality', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStoreSync<number, string>(dir)
  store.set(-0, 'zero')
  await store.ready()
  await store.close()
  const reopened = new FlashStoreSync<number, string>(dir)
  await reopened.ready()
  assert.equal(reopened.get(0), 'zero')
  assert.equal(reopened.get(-0), 'zero')
  assert.deepEqual([...reopened.keys()], [0])
  assert.equal(reopened.delete(-0), true)
  await reopened.ready()
  await reopened.close()
  const backing = new FlashStore<number, string>(dir)
  assert.equal(await backing.has(0), false)
  await backing.destroy()
})

test('write failures surface through ready and close', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStoreSync<string, unknown>(dir)
  store.set('bad', undefined)
  store.set('queued', 1)
  await assert.rejects(store.ready(), /JSON serializable/)
  assert.throws(() => store.set('good', 1), /JSON serializable/)
  assert.throws(() => store.delete('bad'), /JSON serializable/)
  assert.throws(() => store.clear(), /JSON serializable/)
  assert.equal(store.has('good'), false)
  await assert.rejects(store.close(), /JSON serializable/)
  const reopened = new FlashStore<string, unknown>(dir)
  assert.equal(await reopened.get('queued'), undefined)
  await reopened.destroy()
})

test('destroy closes the backing store after a write failure without deleting data', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStoreSync<string, unknown>(dir)
  store.set('saved', 1)
  store.set('bad', undefined)
  await assert.rejects(store.destroy(), /JSON serializable/)
  const backing: FlashStore<string, unknown> = Reflect.get(store, 'flashStore')
  await assert.rejects(backing.get('saved'), /closed/i)
  const reopened = new FlashStore<string, unknown>(dir)
  assert.equal(await reopened.get('saved'), 1)
  await reopened.destroy()
})

test('close preserves both write and close failures', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStoreSync<string, unknown>(dir)
  const backing: FlashStore<string, unknown> = Reflect.get(store, 'flashStore')
  const close = backing.close.bind(backing)
  backing.close = async () => {
    throw new Error('close failed')
  }
  try {
    store.set('bad', undefined)
    await assert.rejects(store.close(), (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.errors[0].message, /JSON serializable/)
      assert.match(error.errors[1].message, /close failed/)
      return true
    })
  } finally {
    backing.close = close
    await close()
  }
})

test('Map operations reflect cached data and queue persistence', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStoreSync<string, number>(dir)
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
  const reopened = new FlashStore<string, number>(dir)
  assert.deepEqual(await Array.fromAsync(reopened.entries()), [
    ['b', 2],
    ['c', 3],
    ['d', 4],
  ])
  await reopened.destroy()
})
