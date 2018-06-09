/**
 * ES6 Map API with Async
 */
export interface AsyncMap<K = any, V = any> {
  [Symbol.asyncIterator]() : AsyncIterableIterator<[K, V]>
  size                     : Promise<number>

  clear   ()                 : Promise<void>
  delete  (key: K)           : Promise<void>
  entries()                  : AsyncIterableIterator<[K, V]>
  get     (key: K)           : Promise<V | undefined>
  has     (key: K)           : Promise<boolean>
  keys    ()                 : AsyncIterableIterator<K>
  set     (key: K, value: V) : Promise<void>
  values  ()                 : AsyncIterableIterator<V>
}
