import { Brolog } from 'brolog'

/// <reference path="./typings.d.ts" />

// https://github.com/Microsoft/TypeScript/issues/14151#issuecomment-280812617
if (!Symbol.asyncIterator) {
  (<any>Symbol).asyncIterator = Symbol.for('Symbol.asyncIterator')
}

export const log = new Brolog()

export { VERSION } from './version'
