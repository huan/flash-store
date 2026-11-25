/**
 * Shares the published package identity and public logger across runtime
 * entry points. TypeScript emits the imported manifest during packaging.
 */
import { log } from 'brolog'
import manifest from '../../package.json' with { type: 'json' }

const VERSION = manifest.version

export { log, VERSION }
