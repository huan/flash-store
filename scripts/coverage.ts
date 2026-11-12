/**
 * Collects native runtime coverage, checks independent baselines, and emits local reports.
 * Node coverage is LCOV; Deno provides both LCOV and HTML directly.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const runtime = process.argv[2]
if (runtime !== 'node' && runtime !== 'deno')
  throw new Error('Expected node or deno')
const baselines: Record<
  'node' | 'deno',
  Record<'lines' | 'branches' | 'functions', number>
> = JSON.parse(
  await readFile(
    new URL('../coverage-baselines.json', import.meta.url),
    'utf8',
  ),
)
const directory = resolve('coverage', runtime)
await mkdir(directory, { recursive: true })
let lcov: string
if (runtime === 'node') {
  const result = await exec(
    process.execPath,
    [
      '--test',
      '--experimental-test-coverage',
      '--test-coverage-include=src/*.ts',
      '--test-coverage-exclude=src/*.test.ts',
      '--test-coverage-include-all',
      '--test-reporter=lcov',
      'src/*.test.ts',
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  )
  lcov = result.stdout
  await writeFile(resolve(directory, 'lcov.info'), lcov)
  const escapeHtml = (text: string) =>
    text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  const sections: string[] = []
  for (const record of lcov.split('end_of_record')) {
    const file = record.match(/^SF:(.+)$/m)?.[1]
    if (!file) continue
    const source = await readFile(resolve(file), 'utf8')
    const counts = new Map<number, number>()
    for (const match of record.matchAll(/^DA:(\d+),(\d+)/gm))
      counts.set(Number(match[1]), Number(match[2]))
    const lines = source
      .split('\n')
      .map((line, index) => {
        const count = counts.get(index + 1)
        const style = count === undefined ? '' : count === 0 ? 'miss' : 'hit'
        return `<span class="${style}">${String(index + 1).padStart(4)} ${escapeHtml(line)}</span>`
      })
      .join('\n')
    sections.push(`<h2>${escapeHtml(file)}</h2><pre>${lines}</pre>`)
  }
  await mkdir(resolve(directory, 'html'), { recursive: true })
  await writeFile(
    resolve(directory, 'html/index.html'),
    `<!doctype html><meta charset="utf-8"><title>Node coverage</title><style>span{display:block}.hit{background:#e2f5e2}.miss{background:#ffe5e5}pre{overflow:auto}</style><h1>Node coverage</h1>${sections.join('')}`,
  )
} else {
  const raw = resolve(directory, 'raw')
  const result = await exec(
    'deno',
    [
      'test',
      '--no-check',
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--allow-ffi',
      '--allow-sys=homedir',
      `--coverage=${raw}`,
      '--clean',
      'src/',
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  )
  process.stdout.write(result.stdout)
  const report = await exec('deno', ['coverage', '--lcov', raw], {
    maxBuffer: 10 * 1024 * 1024,
  })
  lcov = report.stdout
  await writeFile(resolve(directory, 'lcov.info'), lcov)
  await exec('deno', ['coverage', '--html', raw])
}

for (const [metric, found, hit] of [
  ['lines', 'LF', 'LH'],
  ['branches', 'BRF', 'BRH'],
  ['functions', 'FNF', 'FNH'],
] as const) {
  const sum = (label: string) =>
    [...lcov.matchAll(new RegExp(`^${label}:(\\d+)$`, 'gm'))].reduce(
      (total, match) => total + Number(match[1]),
      0,
    )
  const total = sum(found)
  if (!total) throw new Error(`${runtime} coverage has no ${metric} data`)
  const percentage = (100 * sum(hit)) / total
  const minimum = baselines[runtime][metric]
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100)
    throw new Error(`Invalid ${runtime} ${metric} coverage baseline`)
  console.log(
    `${runtime} ${metric}: ${percentage.toFixed(2)}% (minimum ${minimum}%)`,
  )
  if (percentage < minimum)
    throw new Error(`${runtime} ${metric} coverage regressed`)
}
