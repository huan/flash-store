/**
 * Shares package identity and the existing public logger between both store APIs.
 * The manifest is copied beside the compiled source during package emission.
 */
import { readFileSync } from 'node:fs'
import { log } from 'brolog'

const packageJson: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
if (
  typeof packageJson !== 'object' ||
  packageJson === null ||
  !('version' in packageJson) ||
  typeof packageJson.version !== 'string'
) {
  throw new Error('Package manifest does not contain a version')
}
const VERSION = packageJson.version

export { log, VERSION }
