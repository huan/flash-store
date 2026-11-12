/**
 * Rehearses npm publication in an isolated directory and verifies installed ESM and types.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const directory = await mkdtemp(join(tmpdir(), 'flash-store-pack-'))
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this script with npm run test:pack')

try {
  const { stdout } = await exec(process.execPath, [
    npm,
    'pack',
    '--json',
    '--pack-destination',
    directory,
  ])
  const result: { filename: string }[] = JSON.parse(stdout)
  const filename = result[0]?.filename
  if (!filename) throw new Error('npm pack did not return a tarball')
  await writeFile(
    join(directory, 'package.json'),
    '{"private":true,"type":"module"}',
  )
  await exec(
    process.execPath,
    [npm, 'install', '--no-audit', '--no-fund', join(directory, filename)],
    { cwd: directory },
  )
  await writeFile(
    join(directory, 'smoke.mjs'),
    `
    import assert from 'node:assert/strict'
    import { mkdtemp, rm } from 'node:fs/promises'
    import { tmpdir } from 'node:os'
    import { join } from 'node:path'
    import FlashStore, { FlashStoreSync, VERSION } from 'flash-store'
    const dir = await mkdtemp(join(tmpdir(), 'flash-store-consumer-'))
    try {
      const store = new FlashStore(dir)
      await store.set('key', { value: 42 })
      await store.close()
      const reopened = new FlashStoreSync(dir)
      await reopened.ready()
      assert.deepEqual(reopened.get('key'), { value: 42 })
      assert.match(VERSION, /^2\\./)
      await reopened.destroy()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  `,
  )
  await exec(process.execPath, [join(directory, 'smoke.mjs')], {
    cwd: directory,
  })
  await writeFile(
    join(directory, 'consumer.mts'),
    `
    import FlashStore, { FlashStoreSync, type IteratorOptions } from 'flash-store'
    const store = new FlashStore<string, number>('data')
    const sync = new FlashStoreSync<string, number>('other')
    const map: Map<string, number> = sync
    const options: IteratorOptions<string> = { gte: 'a' }
    void store.keys(options)
    const values: number[] = []
    void store.forEach(value => values.push(value))
    void store.forEach(async value => { await Promise.resolve(value) })
    void map
    sync.set('a', 1)
  `,
  )
  await exec(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--target',
      'ES2025',
      '--lib',
      'ESNext',
      join(directory, 'consumer.mts'),
    ],
    { cwd: directory },
  )
  console.log('Installed ESM package and declarations verified')
} finally {
  await rm(directory, { recursive: true, force: true })
}
