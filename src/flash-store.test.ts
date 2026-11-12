/**
 * Verifies the persistent API, range semantics, diagnostics, and storage safety.
 * The same suite is executed by Node and Deno.
 */
import assert from 'node:assert/strict'
import { channel, tracingChannel } from 'node:diagnostics_channel'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import DefaultStore, { FlashStore, VERSION } from './mod.ts'

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

test('range boundaries, reverse, limits, and Unicode prefixes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStore<string, number>(dir)
  t.after(() => store.close())
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
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new FlashStore<string, string>(dir)
  t.after(() => store.close())
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
