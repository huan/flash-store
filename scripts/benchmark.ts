/**
 * Benchmarks FlashStore's public API against native LMDB using identical JSON bytes.
 * Owns disposable databases, warm-up, calibration, validation, and reporting.
 * Memory-backed storage exposes per-call API overhead; the selected directory
 * shows durable mutation cost, where fsync latency can hide that overhead.
 * Diagnostic LMDB variants attribute FlashStore costs. Neither engine's
 * durability settings are changed; setup and full validation are untimed.
 */
import { mkdtemp, readFile, rm, stat, statfs } from 'node:fs/promises'
import { arch, cpus, platform, release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { IF_EXISTS, open } from 'lmdb'
import { FlashStore, log, VERSION } from '../src/mod.ts'

interface Value {
  key: string
  payload: string
}

interface Measurement {
  elapsed: number
  count: number
}

type Operation =
  | 'read'
  | 'iterate'
  | 'insert'
  | 'delete'
  | 'insert-batch'
  | 'delete-batch'
type Mode = 'memory' | 'disk'

/** One timed API path. Only `reports` are recorded; other methods support setup. */
interface Variant {
  name: string
  reports: readonly Operation[]
  read?(passes: number): number | Promise<number>
  iterate?(passes: number): number | Promise<number>
  insert(key: string): Promise<unknown>
  delete(key: string): Promise<unknown>
  size(): Promise<number>
}

/** An open database with its variants; validation reads every entry untimed. */
interface Engine {
  variants: Variant[]
  validate(keys: string[]): Promise<void>
  close(): Promise<void>
}

const FLASH = 'FlashStore'
const LMDB = 'LMDB'
const allOperations: Operation[] = [
  'read',
  'iterate',
  'insert',
  'delete',
  'insert-batch',
  'delete-batch',
]
const seed = 0x1a2b3c4d
const payload = 'x'.repeat(128)
const sequentialMutations = 50
const batchMutations = 256
const batchSize = 32
// Linux statfs magic numbers; other platforms report the directory as unverified.
const memoryFilesystems = new Map([
  [0x01021994, 'tmpfs'],
  [0x858458f6, 'ramfs'],
])

const { values } = parseArgs({
  allowNegative: true,
  options: {
    count: { type: 'string', default: '5000' },
    dir: { type: 'string', default: tmpdir() },
    'memory-dir': { type: 'string' },
    memory: { type: 'boolean', default: true },
    duration: { type: 'string', default: '200' },
    trials: { type: 'string', default: '6' },
  },
})
const count = Number(values.count)
if (!Number.isSafeInteger(count) || count < 1 || count > 100_000_000)
  throw new RangeError('--count must be an integer between 1 and 100000000')
const duration = Number(values.duration)
if (!Number.isSafeInteger(duration) || duration < 1 || duration > 60_000)
  throw new RangeError('--duration must be an integer between 1 and 60000 ms')
const trials = Number(values.trials)
if (!Number.isSafeInteger(trials) || trials < 1 || trials > 25)
  throw new RangeError('--trials must be an integer between 1 and 25')
const directory = resolve(values.dir)

/** Return whether a path is an existing directory, without throwing for absent paths. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Resolve the memory-backed directory before creating anything. An explicit
 * directory must exist; the Linux default is skipped when unavailable.
 */
async function resolveMemoryDirectory(): Promise<
  { path: string; label: string } | string
> {
  if (!values.memory) return 'disabled with --no-memory'
  const requested = values['memory-dir']
  if (requested === undefined && !(await isDirectory('/dev/shm')))
    return '/dev/shm is unavailable; pass --memory-dir'
  const path = resolve(requested ?? '/dev/shm')
  if (!(await isDirectory(path)))
    throw new Error(`--memory-dir ${path} is not an existing directory`)
  const fs = await statfs(path)
  // Two databases exist at once; allow generous LMDB page and copy-on-write overhead.
  const required = count * 1024 * 2 + 16 * 1024 * 1024
  if (fs.bavail * fs.bsize < required)
    throw new RangeError(
      `--memory-dir ${path} needs about ${Math.ceil(required / 2 ** 20)} MiB free; lower --count or pass --no-memory`,
    )
  const type = memoryFilesystems.get(fs.type)
  return { path, label: type ?? 'not verified memory-backed' }
}

/** Close resources even when work fails, without hiding either error. */
async function withCleanup<T>(
  work: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let result: T
  try {
    result = await work()
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Work and cleanup failed')
    }
    throw error
  }
  await cleanup()
  return result
}

/** Seed identical JSON values in one untimed transaction before opening either API. */
async function preload(path: string, keys: string[]): Promise<void> {
  const db = open<string, string>({ path, noSubdir: false, encoding: 'string' })
  await withCleanup(
    async () => {
      db.transactionSync(() => {
        for (const key of keys)
          db.putSync(key, JSON.stringify({ key, payload }))
      })
    },
    () => db.close(),
  )
}

/** Create the same deterministic random access order for each engine and trial. */
function shuffle(keys: string[]): string[] {
  const shuffled = [...keys]
  let state = seed
  for (let i = shuffled.length - 1; i > 0; i--) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    const index = (state >>> 0) % (i + 1)
    const left = shuffled[i]
    const right = shuffled[index]
    if (left === undefined || right === undefined)
      throw new Error('Invalid shuffle index')
    shuffled[i] = right
    shuffled[index] = left
  }
  return shuffled
}

/** Reject missing or corrupted values instead of reporting misleading timings. */
function verifyValue(value: unknown, key: string): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('key' in value) ||
    value.key !== key ||
    !('payload' in value) ||
    value.payload !== payload
  )
    throw new Error(`Incorrect value for ${key}`)
}

/** Consume values with identical lightweight work on every timed read path. */
function checksum(value: Value | undefined): number {
  return (value?.key.length ?? 0) + (value?.payload.length ?? 0)
}

/** Decode benchmark-owned JSON; full value validation happens outside timed loops. */
function decode(value: string | undefined): Value | undefined {
  return value === undefined ? undefined : JSON.parse(value)
}

/** Drain every batch before proceeding or propagating failures; never time only enqueueing. */
async function mutate(
  keys: string[],
  concurrency: number,
  work: (key: string) => Promise<unknown>,
): Promise<void> {
  if (concurrency === 1) {
    for (const key of keys) await work(key)
    return
  }
  for (let offset = 0; offset < keys.length; offset += concurrency) {
    const results = await Promise.allSettled(
      keys
        .slice(offset, offset + concurrency)
        .map((key) => new Promise((resolve) => resolve(work(key)))),
    )
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length) throw new AggregateError(errors, 'Mutation batch failed')
  }
}

/** Open FlashStore's public async API as a single variant. */
function openFlash(path: string, randomKeys: string[]): Engine {
  const store = new FlashStore<string, Value>(path)
  return {
    variants: [
      {
        name: FLASH,
        reports: allOperations,
        read: async (passes) => {
          let sum = 0
          for (let pass = 0; pass < passes; pass++)
            for (const key of randomKeys) sum += checksum(await store.get(key))
          return sum
        },
        iterate: async (passes) => {
          let sum = 0
          for (let pass = 0; pass < passes; pass++)
            for await (const [key, value] of store.entries())
              sum += key.length + checksum(value)
          return sum
        },
        insert: (key) => store.set(key, { key, payload }),
        delete: (key) => store.delete(key),
        size: () => store.size,
      },
    ],
    validate: async (keys) => {
      if ((await store.size) !== keys.length)
        throw new Error('FlashStore: incorrect entry count')
      let index = 0
      for await (const [key, value] of store.entries()) {
        if (key !== keys[index++]) throw new Error('FlashStore: incorrect scan')
        verifyValue(value, key)
      }
      if (index !== keys.length) throw new Error('FlashStore: incomplete scan')
    },
    close: () => store.close(),
  }
}

/**
 * Open native LMDB, optionally with diagnostic variants that each add one
 * FlashStore behavior: an async call per read, an async generator per scan,
 * or the conditional IF_EXISTS remove that lets delete() report whether a
 * key existed (a plain remove resolves true even for absent keys).
 */
function openLmdb(
  path: string,
  randomKeys: string[],
  diagnostics: boolean,
): Engine {
  const db = open<string, string>({ path, noSubdir: false, encoding: 'string' })
  const insert = (key: string) => db.put(key, JSON.stringify({ key, payload }))
  const remove = (key: string) => db.remove(key)
  const size = async () => db.getCount()
  const variants: Variant[] = [
    {
      name: LMDB,
      reports: allOperations,
      read: (passes) => {
        let sum = 0
        for (let pass = 0; pass < passes; pass++)
          for (const key of randomKeys) sum += checksum(decode(db.get(key)))
        return sum
      },
      iterate: (passes) => {
        let sum = 0
        for (let pass = 0; pass < passes; pass++)
          for (const { key, value } of db.getRange())
            sum += key.length + checksum(decode(value))
        return sum
      },
      insert,
      delete: remove,
      size,
    },
  ]
  if (diagnostics) {
    const get = async (key: string) => decode(db.get(key))
    async function* entries(): AsyncGenerator<[string, Value | undefined]> {
      for (const { key, value } of db.getRange()) yield [key, decode(value)]
    }
    variants.push(
      {
        name: 'LMDB + async get',
        reports: ['read'],
        read: async (passes) => {
          let sum = 0
          for (let pass = 0; pass < passes; pass++)
            for (const key of randomKeys) sum += checksum(await get(key))
          return sum
        },
        insert,
        delete: remove,
        size,
      },
      {
        name: 'LMDB + async generator',
        reports: ['iterate'],
        iterate: async (passes) => {
          let sum = 0
          for (let pass = 0; pass < passes; pass++)
            for await (const [key, value] of entries())
              sum += key.length + checksum(value)
          return sum
        },
        insert,
        delete: remove,
        size,
      },
      {
        name: 'LMDB + remove(IF_EXISTS)',
        reports: ['delete', 'delete-batch'],
        insert,
        delete: async (key) => {
          if (!(await db.remove(key, IF_EXISTS)))
            throw new Error(`LMDB: IF_EXISTS did not remove ${key}`)
        },
        size,
      },
    )
  }
  return {
    variants,
    validate: async (keys) => {
      if (db.getCount() !== keys.length)
        throw new Error('LMDB: incorrect entry count')
      let index = 0
      for (const { key, value } of db.getRange()) {
        if (key !== keys[index++]) throw new Error('LMDB: incorrect scan')
        verifyValue(decode(value), key)
      }
      if (index !== keys.length) throw new Error('LMDB: incomplete scan')
    },
    close: () => db.close(),
  }
}

const passCounts = new Map<'read' | 'iterate', number>()

/**
 * Give every variant the same pass count, lasting at least `duration` for the
 * fastest. The first call warms up each variant and calibrates; later calls
 * reuse the count and recalibrate together if any sample becomes too short.
 */
async function measurePasses(
  variants: Variant[],
  operation: 'read' | 'iterate',
  expected: number,
  itemsPerPass: number,
): Promise<Map<string, Measurement>> {
  const run = async (variant: Variant, passes: number) => {
    const work = variant[operation]
    if (!work) throw new Error(`${variant.name} cannot ${operation}`)
    const start = performance.now()
    const sum = await work(passes)
    const elapsed = performance.now() - start
    if (sum !== expected * passes)
      throw new Error(`${variant.name}: incorrect ${operation} checksum`)
    return { elapsed, count: itemsPerPass * passes }
  }
  let passes = passCounts.get(operation)
  if (passes === undefined) {
    passes = 1
    for (const variant of variants) {
      let completed = 0
      let elapsed = 0
      while (elapsed < duration) {
        elapsed += (await run(variant, 1)).elapsed
        completed++
      }
      passes = Math.max(
        passes,
        Math.ceil((duration * completed * 1.2) / elapsed),
      )
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const samples = new Map<string, Measurement>()
    for (const variant of variants)
      samples.set(variant.name, await run(variant, passes))
    const shortest = Math.min(
      ...[...samples.values()].map((sample) => sample.elapsed),
    )
    if (shortest >= duration) {
      passCounts.set(operation, passes)
      return samples
    }
    passes = Math.ceil(passes * (duration / shortest) * 1.2)
  }
  throw new Error(`${operation} calibration did not stabilize; rerun when idle`)
}

/**
 * Time insert-then-delete cycles of absent keys until both phases reach
 * `minimum`; size checks between phases are untimed.
 */
async function measureMutations(
  variant: Variant,
  insertKeys: string[],
  deleteKeys: string[],
  concurrency: number,
  minimum: number,
  baseSize: number,
): Promise<[Measurement, Measurement]> {
  const insert = { elapsed: 0, count: 0 }
  const remove = { elapsed: 0, count: 0 }
  do {
    let start = performance.now()
    await mutate(insertKeys, concurrency, variant.insert)
    insert.elapsed += performance.now() - start
    insert.count += insertKeys.length
    if ((await variant.size()) !== baseSize + insertKeys.length)
      throw new Error(`${variant.name}: incorrect count after inserts`)
    start = performance.now()
    await mutate(deleteKeys, concurrency, variant.delete)
    remove.elapsed += performance.now() - start
    remove.count += deleteKeys.length
    if ((await variant.size()) !== baseSize)
      throw new Error(`${variant.name}: incorrect count after deletes`)
  } while (insert.elapsed < minimum || remove.elapsed < minimum)
  return [insert, remove]
}

const samples: Record<Mode, Map<string, Measurement[]>> = {
  memory: new Map(),
  disk: new Map(),
}

/** Append a sample for a mode, variant, and operation. */
function record(
  mode: Mode,
  variant: string,
  operation: Operation,
  sample: Measurement,
): void {
  const id = `${variant}:${operation}`
  const list = samples[mode].get(id) ?? []
  list.push(sample)
  samples[mode].set(id, list)
}

/** Run one paired trial on fresh databases and delete them afterward. */
async function runTrial(
  mode: Mode,
  root: string,
  trial: number,
  keys: string[],
  randomKeys: string[],
): Promise<void> {
  const trialDir = join(root, String(trial))
  const flashPath = join(trialDir, FLASH)
  const lmdbPath = join(trialDir, LMDB)
  const newKeys = Array.from(
    { length: Math.max(sequentialMutations, batchMutations) },
    (_, index) => `new-${String(index).padStart(8, '0')}`,
  )
  const warmKeys = newKeys.slice(0, 8)
  const expected = keys.reduce(
    (sum, key) => sum + key.length + payload.length,
    0,
  )
  await withCleanup(
    async () => {
      await preload(flashPath, keys)
      await preload(lmdbPath, keys)
      const flash = openFlash(flashPath, randomKeys)
      await withCleanup(
        async () => {
          const lmdb = openLmdb(lmdbPath, randomKeys, mode === 'memory')
          await withCleanup(
            async () => {
              await flash.validate(keys)
              await lmdb.validate(keys)
              const variants = [...flash.variants, ...lmdb.variants]
              // Alternate order so neither engine always runs first.
              if (trial % 2) variants.reverse()
              if (mode === 'memory') {
                for (const operation of ['read', 'iterate'] as const) {
                  const measured = await measurePasses(
                    variants.filter((v) => v.reports.includes(operation)),
                    operation,
                    operation === 'iterate'
                      ? expected + keys.join('').length
                      : expected,
                    keys.length,
                  )
                  for (const [name, sample] of measured)
                    record(mode, name, operation, sample)
                }
              }
              const mutationKinds = [
                [1, sequentialMutations, 'insert', 'delete'],
                [batchSize, batchMutations, 'insert-batch', 'delete-batch'],
              ] as const
              for (const [
                concurrency,
                size,
                insertOp,
                deleteOp,
              ] of mutationKinds) {
                const insertKeys = newKeys.slice(0, size)
                const deleteKeys = shuffle(insertKeys)
                for (const variant of variants) {
                  const reportsInsert = variant.reports.includes(insertOp)
                  const reportsDelete = variant.reports.includes(deleteOp)
                  if (!reportsInsert && !reportsDelete) continue
                  await measureMutations(
                    variant,
                    warmKeys,
                    warmKeys,
                    concurrency,
                    0,
                    keys.length,
                  )
                  const [insert, remove] = await measureMutations(
                    variant,
                    insertKeys,
                    deleteKeys,
                    concurrency,
                    mode === 'memory' ? duration : 0,
                    keys.length,
                  )
                  if (reportsInsert)
                    record(mode, variant.name, insertOp, insert)
                  if (reportsDelete)
                    record(mode, variant.name, deleteOp, remove)
                }
              }
              await flash.validate(keys)
              await lmdb.validate(keys)
            },
            () => lmdb.close(),
          )
        },
        () => flash.close(),
      )
    },
    () => rm(trialDir, { recursive: true, force: true }),
  )
}

/** Calculate the midpoint for even-sized samples without changing the caller's array. */
function median(list: number[]): number {
  const sorted = [...list].sort((a, b) => a - b)
  const lower = sorted[Math.floor((sorted.length - 1) / 2)]
  const upper = sorted[Math.floor(sorted.length / 2)]
  if (lower === undefined || upper === undefined)
    throw new Error('No benchmark samples')
  return (lower + upper) / 2
}

/** Return the samples for a variant and operation, failing if any are missing. */
function samplesFor(
  mode: Mode,
  variant: string,
  operation: Operation,
): Measurement[] {
  const list = samples[mode].get(`${variant}:${operation}`)
  if (!list?.length) throw new Error(`Missing ${variant} ${operation} samples`)
  return list
}

const rate = (sample: Measurement) => (sample.count * 1000) / sample.elapsed

/** Per-trial throughput ratios; trials share order and databases, so pairs are comparable. */
function pairedRatios(subject: Measurement[], baseline: Measurement[]) {
  return subject.map((sample, index) => {
    const other = baseline[index]
    if (!other) throw new Error('Missing paired sample')
    return rate(sample) / rate(other)
  })
}

/** Describe the paired ratio range without implying statistical confidence. */
function describeRatios(ratios: number[]): string {
  const min = Math.min(...ratios)
  const max = Math.max(...ratios)
  return `paired ratio range: ${min.toFixed(3)}-${max.toFixed(3)}x; ${min <= 1 && max >= 1 ? 'mixed/tied results; no clear winner' : 'consistent direction in this run, not a confidence interval'}`
}

/** Print FlashStore versus native LMDB for the given operations. */
function printComparison(mode: Mode, title: string, operations: Operation[]) {
  console.log(`\n${title}`)
  console.log(
    'Operation       FlashStore ops/s     us/op      LMDB ops/s     us/op   Paired Flash/LMDB',
  )
  for (const operation of operations) {
    const flash = samplesFor(mode, FLASH, operation)
    const lmdb = samplesFor(mode, LMDB, operation)
    const flashRate = median(flash.map(rate))
    const lmdbRate = median(lmdb.map(rate))
    const ratios = pairedRatios(flash, lmdb)
    console.log(
      `${operation.padEnd(15)} ${flashRate.toFixed(0).padStart(13)} ${(1e6 / flashRate).toFixed(3).padStart(9)} ${lmdbRate.toFixed(0).padStart(15)} ${(1e6 / lmdbRate).toFixed(3).padStart(9)} ${median(ratios).toFixed(3).padStart(10)}x`,
    )
    console.log(
      `  range (ops/s) FlashStore ${Math.min(...flash.map(rate)).toFixed(0)}-${Math.max(...flash.map(rate)).toFixed(0)} | LMDB ${Math.min(...lmdb.map(rate)).toFixed(0)}-${Math.max(...lmdb.map(rate)).toFixed(0)}`,
    )
    console.log(`  ${describeRatios(ratios)}`)
  }
}

/**
 * Print each diagnostic variant with FlashStore and native LMDB throughput
 * from the same trials, plus paired ratios against native LMDB.
 */
function printDiagnostics(): void {
  console.log(
    '\nDiagnostics (memory): native LMDB plus one FlashStore behavior',
  )
  console.log(
    'Operation       Variant                    Variant ops/s  FlashStore ops/s   LMDB ops/s  Variant/LMDB  Flash/LMDB',
  )
  for (const [id, list] of samples.memory) {
    const [name = '', operation] = id.split(':') as [string, Operation]
    if (name === FLASH || name === LMDB) continue
    const lmdb = samplesFor('memory', LMDB, operation)
    const flash = samplesFor('memory', FLASH, operation)
    const ratios = pairedRatios(list, lmdb)
    console.log(
      `${operation.padEnd(15)} ${name.padEnd(26)} ${median(list.map(rate)).toFixed(0).padStart(13)} ${median(flash.map(rate)).toFixed(0).padStart(17)} ${median(lmdb.map(rate)).toFixed(0).padStart(12)} ${median(ratios).toFixed(3).padStart(12)}x ${median(pairedRatios(flash, lmdb)).toFixed(3).padStart(10)}x`,
    )
    console.log(`  ${describeRatios(ratios)}`)
  }
}

/** List every sample so readers can judge duration and spread. */
function printSamples(mode: Mode): void {
  console.log(`\nTrial samples, ${mode} (operations / elapsed ms):`)
  for (const [id, list] of samples[mode]) {
    const [variant, operation] = id.split(':')
    console.log(
      `  ${operation} ${variant}: ${list.map((s) => `${s.count}/${s.elapsed.toFixed(1)}`).join(', ')}`,
    )
  }
}

const manifest: unknown = JSON.parse(
  await readFile(new URL('package.json', import.meta.resolve('lmdb')), 'utf8'),
)
if (
  typeof manifest !== 'object' ||
  manifest === null ||
  !('version' in manifest) ||
  typeof manifest.version !== 'string'
)
  throw new Error('LMDB package manifest does not contain a version')

const memory = await resolveMemoryDirectory()
log.level('error')
const started = performance.now()
const keys = Array.from(
  { length: count },
  (_, index) => `key-${String(index).padStart(8, '0')}`,
)
const randomKeys = shuffle(keys)

console.log(
  `FlashStore ${VERSION} | lmdb ${manifest.version} | Node ${process.version}`,
)
console.log(
  `${platform()} ${release()} ${arch()} | CPU: ${cpus()[0]?.model ?? 'unknown'}`,
)
console.log(
  `Entries: ${count} | payload: 128 ASCII bytes | seed: 0x${seed.toString(16)} | trials: ${trials} | minimum sample: ${duration} ms`,
)
console.log(
  `Mutations use absent keys: ${sequentialMutations} sequential, ${batchMutations} in batches of ${batchSize}; default durability; identical JSON; log level: error`,
)

/** Run all trials for one mode in a new directory that is always removed. */
async function runMode(mode: Mode, parent: string): Promise<void> {
  const root = await mkdtemp(join(parent, 'flash-store-benchmark-'))
  await withCleanup(
    async () => {
      for (let trial = 0; trial < trials; trial++) {
        console.log(`${mode} trial ${trial + 1}/${trials}`)
        await runTrial(mode, root, trial, keys, randomKeys)
      }
    },
    () => rm(root, { recursive: true, force: true }),
  )
}

if (typeof memory === 'string') {
  console.log(`API-overhead mode skipped: ${memory}`)
} else {
  console.log(`Memory directory: ${memory.path} (${memory.label})`)
  await runMode('memory', memory.path)
}
console.log(`Durable directory: ${directory}`)
await runMode('disk', directory)

if (typeof memory !== 'string') {
  printComparison(
    'memory',
    'API overhead (memory-backed storage; warm reads/scans; calibrated mutations)',
    allOperations,
  )
  printDiagnostics()
}
printComparison(
  'disk',
  'Durable mutations (selected --dir; fixed sample sizes)',
  ['insert', 'delete', 'insert-batch', 'delete-batch'],
)
if (typeof memory !== 'string') printSamples('memory')
printSamples('disk')
console.log(
  `Total elapsed: ${((performance.now() - started) / 1000).toFixed(2)} s (including setup and cleanup)`,
)
