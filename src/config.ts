/// <reference path="./typings.d.ts" />

// https://github.com/Microsoft/TypeScript/issues/14151#issuecomment-280812617
if (!Symbol.asyncIterator) {
  (<any>Symbol).asyncIterator = Symbol.for('Symbol.asyncIterator')
}

export { log } from 'brolog'

export { version as VERSION } from '../package.json'
