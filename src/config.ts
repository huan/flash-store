/// <reference path="./typings.d.ts" />

import { Brolog }      from 'brolog'

// https://github.com/Microsoft/TypeScript/issues/14151#issuecomment-280812617
if (!Symbol.asyncIterator) {
  (<any>Symbol).asyncIterator = Symbol.for('Symbol.asyncIterator')
}

const log = new Brolog()

export { VERSION }  from './version'

export { log }
