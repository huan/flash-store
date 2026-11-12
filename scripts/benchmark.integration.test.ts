/**
 * Exercises the benchmark CLI's report sections, sample sizes, option validation,
 * and temporary-directory safety. Node-only; runs separately from unit tests.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const script = fileURLToPath(new URL('./benchmark.ts', import.meta.url))
const mutations = ['insert', 'delete', 'insert-batch', 'delete-batch']

/** Return report lines from a header until the next blank line. */
function section(stdout: string, title: string): string[] {
  const lines = stdout.split('\n')
  const start = lines.findIndex((line) => line.startsWith(title))
  assert.ok(start >= 0, `Missing section ${title}`)
  const end = lines.indexOf('', start)
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

/** Parse "count/elapsed" samples for one variant and operation. */
function parseSamples(lines: string[], operation: string, variant: string) {
  const line = lines.find((entry) =>
    entry.startsWith(`  ${operation} ${variant}: `),
  )
  assert.ok(line, `Missing ${operation} ${variant} samples`)
  return line
    .slice(line.indexOf(': ') + 2)
    .split(', ')
    .map((sample) => sample.split('/').map(Number))
}

/** Check comparison rows have finite numeric columns and a paired ratio. */
function assertRows(lines: string[], operations: string[]): void {
  for (const operation of operations) {
    const row = lines.find((line) => line.startsWith(`${operation} `))
    assert.ok(row, `Missing ${operation} row`)
    const columns = row.trim().split(/\s+/)
    assert.equal(columns.length, 6)
    for (const column of columns.slice(1, 5))
      assert.ok(Number.isFinite(Number(column)) && Number(column) >= 0)
    assert.match(columns[5] ?? '', /^\d+\.\d{3}x$/)
  }
}

test('benchmark reports both modes and diagnostics, and removes only its directories', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'flash-benchmark-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const diskParent = join(parent, 'disk')
  const memoryParent = join(parent, 'memory')
  for (const dir of [diskParent, memoryParent]) {
    await mkdir(dir)
    await writeFile(join(dir, 'keep'), 'untouched')
  }

  const { stdout } = await exec(process.execPath, [
    script,
    '--count',
    '300',
    '--duration',
    '10',
    '--trials',
    '2',
    '--dir',
    diskParent,
    '--memory-dir',
    memoryParent,
  ])
  assert.match(stdout, /Entries: 300 .*trials: 2 .*minimum sample: 10 ms/)
  assert.match(stdout, /Memory directory: .*memory \(/)
  assertRows(section(stdout, 'API overhead'), ['read', 'iterate', ...mutations])
  assertRows(section(stdout, 'Durable mutations'), mutations)

  const diagnostics = section(stdout, 'Diagnostics')
  for (const pattern of [
    /^read +LMDB \+ async get /,
    /^iterate +LMDB \+ async generator /,
    /^delete +LMDB \+ remove\(IF_EXISTS\) /,
    /^delete-batch +LMDB \+ remove\(IF_EXISTS\) /,
  ]) {
    const row = diagnostics.find((line) => pattern.test(line))
    assert.ok(row, `Missing ${pattern}`)
    // Variant, FlashStore, and LMDB throughput, then two paired ratios.
    const columns = row.trim().split(/\s+/).slice(-5)
    for (const column of columns.slice(0, 3))
      assert.ok(Number.isFinite(Number(column)) && Number(column) > 0)
    for (const column of columns.slice(3)) assert.match(column, /^\d+\.\d{3}x$/)
  }

  const memory = section(stdout, 'Trial samples, memory')
  for (const operation of ['read', 'iterate']) {
    const variant =
      operation === 'read' ? 'LMDB + async get' : 'LMDB + async generator'
    const flash = parseSamples(memory, operation, 'FlashStore')
    // Calibration gives every variant the same pass count per trial.
    for (const other of ['LMDB', variant])
      assert.deepEqual(
        parseSamples(memory, operation, other).map(([n]) => n),
        flash.map(([n]) => n),
      )
    for (const [operations, elapsed] of flash) {
      assert.ok(operations !== undefined && operations % 300 === 0)
      assert.ok(elapsed !== undefined && elapsed >= 10)
    }
  }
  for (const operation of mutations)
    for (const [, elapsed] of parseSamples(memory, operation, 'FlashStore'))
      assert.ok(elapsed !== undefined && elapsed >= 10)

  const disk = section(stdout, 'Trial samples, disk')
  for (const operation of mutations)
    for (const variant of ['FlashStore', 'LMDB']) {
      const list = parseSamples(disk, operation, variant)
      assert.equal(list.length, 2)
      for (const [operations] of list)
        assert.equal(operations, operation.endsWith('-batch') ? 256 : 50)
    }
  assert.ok(!disk.some((line) => line.includes('LMDB +')))

  for (const dir of [diskParent, memoryParent]) {
    assert.deepEqual(await readdir(dir), ['keep'])
    assert.equal(await readFile(join(dir, 'keep'), 'utf8'), 'untouched')
  }
})

test('benchmark can skip the memory-backed mode', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'flash-benchmark-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const { stdout } = await exec(process.execPath, [
    script,
    '--count',
    '3',
    '--duration',
    '1',
    '--trials',
    '1',
    '--no-memory',
    '--dir',
    parent,
  ])
  assert.match(stdout, /API-overhead mode skipped: disabled with --no-memory/)
  assert.doesNotMatch(stdout, /API overhead \(|Diagnostics/)
  assertRows(section(stdout, 'Durable mutations'), mutations)
  assert.deepEqual(await readdir(parent), [])
})

test('benchmark rejects invalid options before creating a database', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'flash-benchmark-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  for (const option of ['count', 'duration', 'trials']) {
    await assert.rejects(
      exec(process.execPath, [script, `--${option}`, '0', '--dir', parent]),
      new RegExp(`--${option} must be an integer`),
    )
  }
  await assert.rejects(
    exec(process.execPath, [
      script,
      '--memory-dir',
      join(parent, 'missing'),
      '--dir',
      parent,
    ]),
    /--memory-dir .* is not an existing directory/,
  )
  assert.deepEqual(await readdir(parent), [])
})
