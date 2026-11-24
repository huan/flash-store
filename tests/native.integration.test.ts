/**
 * Exercises LMDB files and cursor behavior and the native diagnostics channels.
 * The portable public API suite lives alongside the shared Map implementation.
 */
import assert from 'node:assert/strict'
import { channel, tracingChannel } from 'node:diagnostics_channel'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type TestContext, test } from 'node:test'
import { open } from 'lmdb'
import { FlashStore } from '../src/mod.ts'

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

test('reads and writes existing LMDB JSON records', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flash-store-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const raw = open<unknown, string>({ path: dir, encoding: 'json' })
  await raw.put('existing', { text: 'existing' })
  await raw.close()

  const store = new FlashStore<string, unknown>(dir)
  cleanupStore(t, store, dir)
  assert.deepEqual(await store.get('existing'), { text: 'existing' })
  await store.set('value', { text: 'é😀' })
  await store.close()

  const reopened = open<unknown, string>({ path: dir, encoding: 'json' })
  try {
    assert.deepEqual(reopened.get('value'), { text: 'é😀' })
  } finally {
    await reopened.close()
  }
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
    Reflect.get(store, 'backend'),
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
