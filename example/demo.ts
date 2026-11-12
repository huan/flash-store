/**
 * Demonstrates direct TypeScript execution against an isolated temporary database.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlashStore } from '../src/mod.ts'

const directory = await mkdtemp(join(tmpdir(), 'flash-store-demo-'))
const store = new FlashStore<number, string>(directory)
try {
  await store.set(1, 'a')
  await store.set(2, 'b')
  console.log(await store.get(1))
  for await (const [key, value] of store) console.log(key, value)
} finally {
  await store.close()
  await rm(directory, { recursive: true, force: true })
}
