/**
 * Verifies the persistent API, range semantics, diagnostics, and storage safety.
 * The same suite is executed by Node and Deno.
 */
import assert from 'node:assert/strict'
import { channel, tracingChannel } from 'node:diagnostics_channel'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type TestContext, test } from 'node:test'
import { open } from 'lmdb'
import DefaultStore, { FlashStore, VERSION } from './mod.ts'

/** Closes the LMDB environment before removing files that Windows keeps locked. */
function cleanupStore<K extends string | number, V>(
  t: TestContext,
  store: FlashStore<K, V>,
  dir: string,
): void {
  t.after(async () => {
    try {
      await store.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

test('public entry point exports the package API', () => {
  assert.equal(DefaultStore, FlashStore)
  assert.match(VERSION, /^2\./)
})

test('persists JSON values, reports falsey keys, and reopens', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStore<string, unknown>(dir)
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
  const reopened = new FlashStore<string, unknown>(dir)
  assert.deepEqual(await reopened.get('object'), { nested: [1, 'x'] })
  assert.equal(await reopened.get('false'), false)
  await reopened.clear()
  assert.equal(await reopened.size, 0)
  await reopened.destroy()
})

test('delete reports existence per call, in order with queued writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  const store = new FlashStore<string, number>(dir)
  cleanupStore(t, store, dir)
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
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  const raw = open<unknown, string>({ path: dir, encoding: 'json' })
  await raw.put('existing', { text: 'existing' })
  await raw.close()
  const store = new FlashStore<string, unknown>(dir)
  cleanupStore(t, store, dir)
  assert.deepEqual(await store.get('existing'), { text: 'existing' })
  let calls = 0
  await store.set('value', { toJSON: () => ({ calls: ++calls, text: 'é😀' }) })
  assert.equal(calls, 1)
  assert.deepEqual(await store.get('value'), { calls: 1, text: 'é😀' })
  assert.deepEqual(await Array.fromAsync(store.values()), [
    { text: 'existing' },
    { calls: 1, text: 'é😀' },
  ])
  await assert.rejects(
    () => store.set('invalid', undefined),
    /JSON serializable/,
  )
  await store.close()
  const reopened = open<unknown, string>({ path: dir, encoding: 'json' })
  try {
    assert.deepEqual(reopened.get('value'), { calls: 1, text: 'é😀' })
  } finally {
    await reopened.close()
  }
})

test('range boundaries, reverse, limits, and Unicode prefixes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  const store = new FlashStore<string, number>(dir)
  cleanupStore(t, store, dir)
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

test('prefix iteration reads only its contiguous key interval', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  const store = new FlashStore<string | number, number>(dir)
  cleanupStore(t, store, dir)
  const keys = [
    1,
    'a',
    'ab',
    'ab\u{10ffff}',
    'ab\u{10ffff}z',
    'ac',
    'b',
    'é',
    'é😀',
    'ê',
  ]
  for (const [index, key] of keys.entries()) await store.set(key, index)
  // Count cursor reads to verify that a prefix scan does not visit other entries.
  const db: { getRange: (options: unknown) => Iterable<unknown> } = Reflect.get(
    store,
    'db',
  )
  const getRange = db.getRange.bind(db)
  let reads = 0
  db.getRange = (options) => ({
    *[Symbol.iterator]() {
      for (const entry of getRange(options)) {
        reads++
        yield entry
      }
    },
  })
  const scan = async (options: Parameters<typeof store.keys>[0]) => {
    reads = 0
    return { keys: await Array.fromAsync(store.keys(options)), reads }
  }
  assert.deepEqual(await scan({ prefix: 'ab' }), {
    keys: ['ab', 'ab\u{10ffff}', 'ab\u{10ffff}z'],
    reads: 4,
  })
  assert.deepEqual(await scan({ prefix: 'ab', reverse: true }), {
    keys: ['ab\u{10ffff}z', 'ab\u{10ffff}', 'ab'],
    reads: 4,
  })
  assert.deepEqual(await scan({ prefix: 'ab', reverse: true, limit: 1 }), {
    keys: ['ab\u{10ffff}z'],
    reads: 1,
  })
  assert.deepEqual(await scan({ prefix: 'é' }), {
    keys: ['é', 'é😀'],
    reads: 3,
  })
  assert.deepEqual(await scan({ prefix: 'aa' }), { keys: [], reads: 1 })
  assert.deepEqual(await scan({ prefix: 'aa', reverse: true }), {
    keys: [],
    reads: 1,
  })
  // 'é' sorts after 'z', so the scan reads it once and stops.
  assert.deepEqual(await scan({ prefix: 'z' }), { keys: [], reads: 1 })
  assert.deepEqual(await scan({ prefix: '\u{10ffff}' }), {
    keys: [],
    reads: 0,
  })
  assert.deepEqual(await scan({ prefix: '\u{10ffff}', reverse: true }), {
    keys: [],
    reads: 1,
  })
  assert.deepEqual((await scan({ prefix: '', reverse: true, limit: 2 })).keys, [
    'ê',
    'é😀',
  ])
  assert.deepEqual((await scan({ prefix: '' })).keys, keys.slice(1))
})

test('numeric keys sort naturally and early iteration can close', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStore<number, string>(dir)
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
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStore<number, string>(dir)
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
  const reopened = new FlashStore<number, string>(dir)
  assert.equal(await reopened.get(-0), 'updated')
  assert.equal(await reopened.delete(-0), true)
  assert.equal(await reopened.has(0), false)
  await reopened.destroy()
})

test('forEach awaits callbacks sequentially and preserves callback arguments', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  const store = new FlashStore<string, number>(dir)
  cleanupStore(t, store, dir)
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
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  const store = new FlashStore<string, number>(dir)
  cleanupStore(t, store, dir)
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

test('destroy removes its database directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-guard-'))
  await mkdir(join(dir, 'child'))
  const store = new FlashStore(join(dir, 'child'))
  await store.destroy()
  await rm(dir, { recursive: true })
})

test('destroy refuses protected directories before closing or deleting anything', async () => {
  const action: Promise<void> = Reflect.apply(
    FlashStore.prototype.destroy,
    { workdir: tmpdir() },
    [],
  )
  await assert.rejects(action, /protected directory/)
})

test('concurrent close calls share the same close operation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStore(dir)
  await Promise.all([store.close(), store.close()])
  await store.destroy()
})

test('diagnostic and tracing channels work without exposing stored data', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  const store = new FlashStore<string, string>(dir)
  cleanupStore(t, store, dir)
  const messages: unknown[] = []
  const onMessage = (message: unknown) => messages.push(message)
  const event = channel('flash-store.operation')
  event.subscribe(onMessage)
  try {
    await store.set('secret-key', 'secret-value')
    await store.delete('secret-key')
    await store.clear()
  } finally {
    event.unsubscribe(onMessage)
  }
  assert.deepEqual(messages, [
    { operation: 'set' },
    { operation: 'delete' },
    { operation: 'clear' },
  ])
  const trace = tracingChannel('flash-store.test')
  const seen: string[] = []
  const start = () => seen.push('start')
  const end = () => seen.push('end')
  trace.subscribe({ start, end })
  try {
    assert.equal(
      trace.traceSync(() => 42),
      42,
    )
  } finally {
    trace.unsubscribe({ start, end })
  }
  assert.deepEqual(seen, ['start', 'end'])
})
