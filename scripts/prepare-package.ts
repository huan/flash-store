/**
 * Clears generated packaging output before TypeScript emits the current
 * module tree and its imported manifest. It owns only the repository's dist directory.
 */
import { rm } from 'node:fs/promises'

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true })
