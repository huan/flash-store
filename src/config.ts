/**
 * Shares the published package identity and public logger across runtime
 * entry points. Packaging copies the manifest alongside the compiled modules.
 */
import { log } from 'brolog'
import manifest from '../package.json' with { type: 'json' }

const VERSION = manifest.version

export { log, VERSION }
