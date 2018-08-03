# FLASH-STORE

[![Powered by LevelDB](https://img.shields.io/badge/Powered%20By-LevelDB-green.svg)](https://leveldb.org/)
[![Powered by TypeScript](https://img.shields.io/badge/Powered%20By-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Build Status](https://travis-ci.com/zixia/flash-store.svg?branch=master)](https://travis-ci.com/zixia/flash-store)
[![Build status](https://ci.appveyor.com/api/projects/status/avwx4bnldox01870?svg=true)](https://ci.appveyor.com/project/zixia/flash-store)
[![NPM Version](https://badge.fury.io/js/flash-store.svg)](https://badge.fury.io/js/flash-store)
[![Downloads](http://img.shields.io/npm/dm/flash-store.svg?style=flat-square)](https://npmjs.org/package/flash-store)
[![node](https://img.shields.io/node/v/flash-store.svg?maxAge=604800)](https://nodejs.org/)

FlashStore is a Key-Value persistent storage with easy to use ES6 Map-like API(both Async and Sync support), powered by LevelDB and TypeScript.

![flash store](https://zixia.github.io/flash-store/images/flash-store.png)

## EXAMPLES

Try the following command

```shell
npm install
npm run demo
```

The basic function as follows:

```ts
import { FlashStore } from 'flash-store'

const flashStore = new FlashStore('flashstore.workdir')

await flashStore.put(1, 'a')
console.log(`key: 1, value: ${await flashStore.get(1)}`)
// Output: 'a'

await flashStore.del(1)
console.log(`key: 1, value: ${await flashStore.get(1)}`)
// Output: undefined
```

## API Reference

### `FlashStore`

FlashStore implments the Standard ES6 Map API with Async modification:

```ts
/
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

class FlashStore<K, V> implments AsyncMap<K, V> {}
```

### `FlashStoreSync`

FlashStoreSync implments the Standard ES6 Map API:

```ts
class FlashStoreSync<K, V> implments Map<K, V> {}
```

## DOCUMENT

See [auto generated docs](https://zixia.github.io/flash-store)

* [ECMAScript 6: Maps - 2ality – JavaScript and more](http://2ality.com/2015/01/es6-maps-sets.html)

## SEE ALSO

1. [Node.js databases: an embedded database using LevelDB](https://blog.yld.io/2016/10/24/node-js-databases-an-embedded-database-using-leveldb)
1. [How to Cook a Graph Database in a Night - LevelGraph](http://nodejsconfit.levelgraph.io/)
1. [Graph database JS style for Node.js and the Browser. Built upon LevelUp and LevelDB.](https://github.com/levelgraph/levelgraph)
1. [浅析 Bigtable 和 LevelDB 的实现](http://draveness.me/bigtable-leveldb.html)

## CHANGELOG

### v0.6 master

1. Upgrade to TypeScript 3.0

### v0.4 Jun 2018

#### 1. Refactor API to implenment ES6 `Map` interface

1. Update the API to ES6 `Map`-like, the difference is that FlashStore is all **async**.

#### 2. Add `FlashStoreSync` as a in-memory **Write-back Cache** for Flash-Store

Add a new class `FlashStoreSync` which is a in-memory full loaded **Write-back Cache** for Flash-Store:

1. Writes directly to `cache`, lazy writes to `store`.
1. Reads from cache, never read-miss because cache have the full data of the store which will never expire.
1. API of `FlashStoreSync` is the same as the ES6 `Map`

### v0.2 Sep 2017

Init version, API is LevelDB-like.

## AUTHOR

Huan LI \<zixia@zixia.net\> (http://linkedin.com/in/zixia)

<a href="http://stackoverflow.com/users/1123955/zixia">
  <img src="http://stackoverflow.com/users/flair/1123955.png" width="208" height="58" alt="profile for zixia at Stack Overflow, Q&amp;A for professional and enthusiast programmers" title="profile for zixia at Stack Overflow, Q&amp;A for professional and enthusiast programmers">
</a>

## COPYRIGHT & LICENSE

* Code & Docs © 2017 Huan LI \<zixia@zixia.net\>
* Code released under the Apache-2.0 License
* Docs released under Creative Commons
