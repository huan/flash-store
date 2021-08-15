import { log } from 'brolog'

import { VERSION } from './version'

/// <reference path="./typings.d.ts" />

// https://github.com/Microsoft/TypeScript/issues/14151#issuecomment-280812617
if (!Symbol.asyncIterator) {
  (<any>Symbol).asyncIterator = Symbol.for('Symbol.asyncIterator')
}

export {
  log,
  VERSION,
}
