/// <reference path="./typings.d.ts" />

// https://github.com/Microsoft/TypeScript/issues/14151#issuecomment-280812617
if (!Symbol.asyncIterator) {
  (<any>Symbol).asyncIterator = Symbol.for('Symbol.asyncIterator')
}

import { Brolog } from 'brolog'
export const log = new Brolog()

export let VERSION = '0.0.0'

try {
  const pkg = require('../package.json')
  VERSION = pkg.version
} catch (e) {
  const pkg = require('../../package.json')
  VERSION = pkg.version
}
