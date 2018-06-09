// https://github.com/Microsoft/TypeScript/issues/14151#issuecomment-280812617
if (!Symbol.asyncIterator) {
  (<any>Symbol).asyncIterator = Symbol.for('Symbol.asyncIterator')
}

import Brolog from 'brolog'
export const log = new Brolog()

import { version } from '../package.json'
export const VERSION = version
