/**
 * Places the package manifest beside compiled modules for runtime version reporting.
 * This runs only after a successful package build.
 */
import { copyFile } from 'node:fs/promises'

await copyFile('package.json', 'dist/package.json')
