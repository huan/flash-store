/**
 * Pins which build each tool picks when a consumer imports the package root.
 *
 * Why it exists: the package follows the WinterTC-first rule in AGENTS.md. One
 * root specifier must resolve to the `node/` build under `node` and to the
 * universal `src/` build everywhere else. Build tools silently ignore condition keys
 * they do not know, so a wrong `exports` map yields the wrong build with no
 * error. This test fails instead.
 *
 * It stubs every file named by `exports` in a temporary `node_modules`, so it
 * checks resolution only and needs no `npm run build`. Boundary: it asserts
 * which file is picked, not what that file does. Behaviour of each build is
 * covered by the shared unit suite and the native integration suite.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const exec = promisify(execFile)

const UNIVERSAL = 'dist/src/mod.js'
const SERVER = 'dist/src/node/mod.js'
const TYPES = 'dist/src/mod.d.ts'

/** The only condition keys every popular build tool agrees on, in lookup order. */
const ROOT_CONDITIONS = ['types', 'browser', 'node', 'default']

let dir = ''

/** Collects every file path named anywhere inside an `exports` value. */
function targets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object')
    return Object.values(value).flatMap(targets)
  return []
}

/** Reports whether the Deno binary is available for the Deno resolution case. */
async function hasDeno(): Promise<boolean> {
  try {
    await exec('deno', ['--version'])
    return true
  } catch {
    return false
  }
}

/** Returns the stubbed file that `import 'flash-store'` reaches, relative to the package. */
function stubPath(output: string): string {
  const match = output.match(/node_modules\/flash-store\/(dist\/[^\s"']+)/)
  assert.ok(match?.[1], `no flash-store file in: ${output}`)
  return match[1]
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flash-store-resolution-'))
  const manifest = await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  )
  const pkg = join(dir, 'node_modules', 'flash-store')
  await mkdir(pkg, { recursive: true })
  await writeFile(join(pkg, 'package.json'), manifest)
  // Each stub reports its own path so the resolver result is observable.
  for (const target of new Set(targets(JSON.parse(manifest).exports))) {
    const file = join(pkg, target)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(
      file,
      target.endsWith('.d.ts')
        ? 'export declare const where: string\n'
        : `export default 'node_modules/flash-store/${target.replace('./', '')}'\n`,
    )
  }
  await writeFile(join(dir, 'package.json'), '{"type":"module"}')
  await writeFile(
    join(dir, 'entry.mjs'),
    "import where from 'flash-store'\nconsole.log(where)\n",
  )
  await writeFile(
    join(dir, 'entry.mts'),
    "import { where } from 'flash-store'\nexport { where }\n",
  )
})

after(() => rm(dir, { recursive: true, force: true }))

describe('exports map shape', () => {
  test('the root entry uses only the shared condition vocabulary', async () => {
    const { exports } = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    )
    assert.deepEqual(Object.keys(exports['.']), ROOT_CONDITIONS)
  })
})

describe('bundlers', () => {
  for (const [platform, expected] of [
    ['browser', UNIVERSAL],
    ['node', SERVER],
    ['neutral', UNIVERSAL],
  ] as const) {
    test(`esbuild platform=${platform}`, async () => {
      const { metafile } = await build({
        absWorkingDir: dir,
        entryPoints: ['entry.mjs'],
        bundle: true,
        write: false,
        format: 'esm',
        platform,
        metafile: true,
        logLevel: 'silent',
      })
      assert.equal(stubPath(Object.keys(metafile.inputs).join('\n')), expected)
    })
  }
})

describe('runtimes', () => {
  test('Node', async () => {
    const { stdout } = await exec(process.execPath, ['entry.mjs'], { cwd: dir })
    assert.equal(stubPath(stdout), SERVER)
  })

  test('Deno', async (t) => {
    if (!(await hasDeno())) return t.skip('deno is not installed')
    const { stdout } = await exec(
      'deno',
      ['run', '--node-modules-dir=manual', '-A', 'entry.mjs'],
      { cwd: dir },
    )
    assert.equal(stubPath(stdout), SERVER)
  })
})

describe('TypeScript', () => {
  for (const [module, moduleResolution] of [
    ['nodenext', 'nodenext'],
    ['esnext', 'bundler'],
  ] as const) {
    test(`tsc moduleResolution=${moduleResolution}`, async () => {
      const tsc = join(
        dirname(
          new URL(import.meta.resolve('typescript/package.json')).pathname,
        ),
        'bin/tsc',
      )
      const { stdout } = await exec(
        process.execPath,
        [
          tsc,
          '--noEmit',
          '--skipLibCheck',
          '--target',
          'esnext',
          '--module',
          module,
          '--moduleResolution',
          moduleResolution,
          '--listFiles',
          'entry.mts',
        ],
        { cwd: dir },
      )
      assert.equal(stubPath(stdout), TYPES)
    })
  }
})
