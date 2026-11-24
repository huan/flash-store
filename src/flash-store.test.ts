/**
 * Runs the public async Map contract unchanged against each runtime's store.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import DefaultStore, { FlashStore, FlashStoreSync, VERSION } from '#test-store'
import type { StoreBackend } from './store-backend.ts'
import { testStore } from './test-fixture.ts'

test('public entry point exports the package API', (t) => {
  assert.equal(DefaultStore, FlashStore)
  assert.match(VERSION, /^2\./)
  assert.equal(FlashStore.VERSION, VERSION)
  assert.equal(FlashStoreSync.VERSION, VERSION)
  const { open, openSync } = testStore(t)
  assert.equal(open().version(), VERSION)
  assert.equal(openSync().version(), VERSION)
})

test('persists JSON values, reports falsey keys, and reopens', async (t) => {
  const { open } = testStore(t)
  const store = open<string, unknown>()
  await store.set('false', false)
  await store.set('zero', 0)
  await store.set('null', null)
  await store.set('object', { nested: [1, 'x'] })
  assert.equal(await store.has('false'), true)
  assert.equal(await store.has('zero'), true)
  assert.equal(await store.has('null'), true)
  assert.equal(await store.has('missing'), false)
  assert.equal(await store.delete('missing'), false)
  assert.equal(await store.delete('zero'), true)
  assert.equal(await store.size, 3)
  await store.close()
  const reopened = open<string, unknown>()
  assert.deepEqual(await reopened.get('object'), { nested: [1, 'x'] })
  assert.equal(await reopened.get('false'), false)
  await reopened.clear()
  assert.equal(await reopened.size, 0)
  await reopened.destroy()
})

test('delete reports existence per call, in order with queued writes', async (t) => {
  const { open } = testStore(t)
  const store = open<string, number>()
  await store.set('key', 1)
  assert.deepEqual(
    await Promise.all([
      store.delete('key'),
      store.delete('key'),
      store.delete('missing'),
    ]),
    [true, false, false],
  )
  const [, setThenDelete] = await Promise.all([
    store.set('queued', 1),
    store.delete('queued'),
  ])
  assert.equal(setThenDelete, true)
  assert.equal(await store.has('queued'), false)
  const [deleteThenSet] = await Promise.all([
    store.delete('queued'),
    store.set('queued', 2),
  ])
  assert.equal(deleteThenSet, false)
  assert.equal(await store.get('queued'), 2)
})

test('serializes each value once and reads the resulting JSON', async (t) => {
  const { open } = testStore(t)
  const store = open<string, unknown>()
  let calls = 0
  await store.set('value', { toJSON: () => ({ calls: ++calls, text: 'é😀' }) })
  assert.equal(calls, 1)
  assert.deepEqual(await store.get('value'), { calls: 1, text: 'é😀' })
  assert.deepEqual(await Array.fromAsync(store.values()), [
    { calls: 1, text: 'é😀' },
  ])
  await assert.rejects(
    () => store.set('invalid', undefined),
    /JSON serializable/,
  )
  await store.close()
  const reopened = open<string, unknown>()
  assert.deepEqual(await reopened.get('value'), { calls: 1, text: 'é😀' })
})

test('range boundaries, reverse, limits, and Unicode prefixes', async (t) => {
  const { open } = testStore(t)
  const store = open<string, number>()
  for (const [index, key] of ['a', 'b', 'c', 'é', 'é😀'].entries())
    await store.set(key, index)
  assert.deepEqual(await Array.fromAsync(store.keys({ gt: 'a', lte: 'c' })), [
    'b',
    'c',
  ])
  assert.deepEqual(
    await Array.fromAsync(store.keys({ gte: 'a', lt: 'c', reverse: true })),
    ['b', 'a'],
  )
  assert.deepEqual(
    await Array.fromAsync(store.keys({ reverse: true, limit: 2 })),
    ['é😀', 'é'],
  )
  assert.deepEqual(
    await Array.fromAsync(store.keys({ prefix: 'é', limit: 1 })),
    ['é'],
  )
  assert.deepEqual(await Array.fromAsync(store.keys({ limit: 0 })), [])
  await assert.rejects(
    () => Array.fromAsync(store.keys({ gt: 'a', gte: 'a' })),
    /Conflicting/,
  )
  await assert.rejects(
    () => Array.fromAsync(store.keys({ limit: -1 })),
    /limit/,
  )
  await assert.rejects(() => store.set('invalid\0key', 1), /Keys/)
})

test('numeric keys sort naturally and early iteration can close', async (t) => {
  const { open } = testStore(t)
  const store = open<number, string>()
  await store.set(10, 'ten')
  await store.set(-1, 'negative')
  await store.set(2, 'two')
  assert.deepEqual(await Array.fromAsync(store.keys({ gte: 0 })), [2, 10])
  for await (const key of store.keys()) {
    assert.equal(key, -1)
    break
  }
  await assert.rejects(() => store.set(Number.NaN, 'bad'), /Keys/)
  await store.close()
})

test('treats negative zero as zero in keys and range bounds', async (t) => {
  const { open } = testStore(t)
  const store = open<number, string>()
  await store.set(-1, 'negative')
  await store.set(-0, 'zero')
  await store.set(1, 'positive')
  assert.equal(await store.get(0), 'zero')
  assert.equal(await store.has(0), true)
  await store.set(0, 'updated')
  assert.equal(await store.get(-0), 'updated')
  assert.equal(await store.size, 3)
  assert.deepEqual(await Array.fromAsync(store.keys()), [-1, 0, 1])
  assert.deepEqual(await Array.fromAsync(store.keys({ gte: -0 })), [0, 1])
  assert.deepEqual(await Array.fromAsync(store.keys({ gt: -0 })), [1])
  assert.deepEqual(await Array.fromAsync(store.keys({ lt: -0 })), [-1])
  assert.deepEqual(
    await Array.fromAsync(store.keys({ lte: -0, reverse: true })),
    [0, -1],
  )
  await store.close()
  const reopened = open<number, string>()
  assert.equal(await reopened.get(-0), 'updated')
  assert.equal(await reopened.delete(-0), true)
  assert.equal(await reopened.has(0), false)
  await reopened.destroy()
})

test('forEach awaits callbacks sequentially and preserves callback arguments', async (t) => {
  const { open } = testStore(t)
  const store = open<string, number>()
  await store.set('a', 1)
  await store.set('b', 2)

  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const events: string[] = []
  const operation = store.forEach(async (value, key, actualStore) => {
    assert.equal(actualStore, store)
    events.push(`start ${key}:${value}`)
    if (key === 'a') {
      started.resolve()
      await gate.promise
    }
    events.push(`end ${key}`)
  })
  await started.promise
  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(events, ['start a:1'])
  } finally {
    gate.resolve()
  }
  await operation
  assert.deepEqual(events, ['start a:1', 'end a', 'start b:2', 'end b'])

  const context = { values: [] as number[] }
  await store.forEach(function (this: typeof context, value) {
    this.values.push(value)
  }, context)
  assert.deepEqual(context.values, [1, 2])
})

test('forEach stops and propagates callback failures', async (t) => {
  const { open } = testStore(t)
  const store = open<string, number>()
  await store.set('a', 1)
  await store.set('b', 2)
  const visited: string[] = []
  const failure = new Error('callback failed')
  await assert.rejects(
    store.forEach(async (_, key) => {
      visited.push(key)
      await Promise.resolve()
      throw failure
    }),
    (error: unknown) => error === failure,
  )
  assert.deepEqual(visited, ['a'])
  visited.length = 0
  await assert.rejects(
    store.forEach((_, key) => {
      visited.push(key)
      throw failure
    }),
    (error: unknown) => error === failure,
  )
  assert.deepEqual(visited, ['a'])
  assert.deepEqual(await Array.fromAsync(store.keys()), ['a', 'b'])
})

test('concurrent close calls share the same close operation', async (t) => {
  const { open } = testStore(t)
  const store = open()
  await Promise.all([store.close(), store.close()])
  await store.destroy()
})

test('mixed keys use storage order for scans and Unicode boundaries', async (t) => {
  const { open } = testStore(t)
  const store = open<string | number, number>()
  const keys = [
    -2,
    2,
    10,
    '',
    '\u0001',
    '2',
    '\uE000',
    '\u{10000}',
    '\u{10000}x',
  ]
  for (const key of keys.toReversed()) await store.set(key, 1)
  assert.deepEqual(await Array.fromAsync(store.keys()), keys)
  assert.deepEqual(
    await Array.fromAsync(store.keys({ prefix: '', reverse: true, limit: 2 })),
    keys.slice(-2).toReversed(),
  )
  assert.deepEqual(
    await Array.fromAsync(store.keys({ prefix: '\u{10000}', reverse: true })),
    keys.slice(-2).toReversed(),
  )
  assert.deepEqual(await Array.fromAsync(store.keys({ gt: 2, lte: 2 })), [])
  assert.deepEqual(
    await Array.fromAsync(store.keys({ gte: 10, lt: 2, reverse: true })),
    [],
  )
})

test('enforces the encoded key boundary', async (t) => {
  const { open } = testStore(t)
  const store = open<string, number>()
  const key = `${'x'.repeat(1977)}\u007f`
  await store.set(key, 1)
  assert.equal(await store.get(key), 1)
  assert.deepEqual(await Array.fromAsync(store.keys({ prefix: key })), [key])
  assert.deepEqual(
    await Array.fromAsync(store.keys({ prefix: key, reverse: true })),
    [key],
  )
  await assert.rejects(store.set(`${key}x`, 2), /too large/i)
  await assert.rejects(store.set('😀'.repeat(800), 2), /too large/i)
  await store.set('after-invalid', 2)
  assert.equal(await store.get('after-invalid'), 2)
  await assert.rejects(store.delete(`${key}x`), /too large/i)
  await store.close()
})

test('iteration keeps a snapshot while caller code updates the store', async (t) => {
  const { open } = testStore(t)
  const store = open<string, number>()
  await store.set('a', 1)
  await store.set('b', 2)
  const entries = store.entries()
  try {
    assert.deepEqual((await entries.next()).value, ['a', 1])
    await store.delete('b')
    await store.set('c', 3)
    assert.deepEqual((await entries.next()).value, ['b', 2])
    assert.equal((await entries.next()).done, true)
  } finally {
    await entries.return?.()
  }
  assert.deepEqual(await Array.fromAsync(store.keys()), ['a', 'c'])
})

test('close drains writes and destroy removes only the selected store', async (t) => {
  const { open } = testStore(t)
  const other = testStore(t).open<string, number>()
  const store = open<string, number>()
  const write = store.set('key', 1)
  await Promise.all([store.close(), write, other.set('key', 2)])
  const reopened = open<string, number>()
  assert.equal(await reopened.get('key'), 1)
  await reopened.destroy()
  assert.equal(await open().size, 0)
  assert.equal(await other.get('key'), 2)
})

test('destroy on the same handle does not delete a replacement store', async (t) => {
  const { open } = testStore(t)
  const store = open<string, number>()
  await store.set('original', 1)
  await Promise.all([store.destroy(), store.destroy()])
  const replacement = open<string, number>()
  await replacement.set('replacement', 2)
  await store.destroy()
  assert.equal(await replacement.get('replacement'), 2)
})

test('a failed removal can be retried on the same handle', async (t) => {
  const { open } = testStore(t)
  const store = open<string, number>()
  await store.set('key', 1)
  const backend: StoreBackend = Reflect.get(store, 'backend')
  const destroy = backend.destroy.bind(backend)
  backend.destroy = async () => {
    backend.destroy = destroy
    throw new Error('Removal failed')
  }
  await assert.rejects(store.destroy(), /Removal failed/)
  await store.destroy()
  assert.equal(await open().size, 0)
})

test('size starts its read before a later write or close', async (t) => {
  const store = testStore(t).open<string, number>()
  await store.set('first', 1)
  const sizeBeforeWrite = store.size
  const [size] = await Promise.all([sizeBeforeWrite, store.set('second', 2)])
  assert.equal(size, 1)

  const sizeBeforeClose = store.size
  const [finalSize] = await Promise.all([sizeBeforeClose, store.close()])
  assert.equal(finalSize, 2)
})

test('deletes are atomic across two handles to the same store', async (t) => {
  const { open } = testStore(t)
  const first = open<string, number>()
  const second = open<string, number>()
  await first.set('shared', 1)
  const results = await Promise.all([
    first.delete('shared'),
    second.delete('shared'),
  ])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(await first.has('shared'), false)
  assert.equal(await second.has('shared'), false)
})
