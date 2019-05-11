# FLASH-STORE

[![Powered by LevelDB](https://img.shields.io/badge/Powered%20By-LevelDB-green.svg)](https://leveldb.org/)
[![Powered by TypeScript](https://img.shields.io/badge/Powered%20By-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Build Status](https://travis-ci.com/huan/flash-store.svg?branch=master)](https://travis-ci.com/huan/flash-store)
[![Build status](https://ci.appveyor.com/api/projects/status/avwx4bnldox01870?svg=true)](https://ci.appveyor.com/project/zixia/flash-store)
[![NPM Version](https://badge.fury.io/js/flash-store.svg)](https://badge.fury.io/js/flash-store)
[![npm (tag)](https://img.shields.io/npm/v/flash-store/next.svg)](https://www.npmjs.com/package/flash-store?activeTab=versions)
[![Downloads](http://img.shields.io/npm/dm/flash-store.svg?style=flat-square)](https://npmjs.org/package/flash-store)
[![node](https://img.shields.io/node/v/flash-store.svg?maxAge=604800)](https://nodejs.org/) [![Greenkeeper badge](https://badges.greenkeeper.io/huan/flash-store.svg)](https://greenkeeper.io/)

FlashStore is Key-Value persistent storage with easy to use ES6 Map-like API(both Async and Sync support), powered by LevelDB and TypeScript.

![flash store](https://huan.github.io/flash-store/images/flash-store.png)

## REQUIRES

1. Node.js v10 or above

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

See [auto generated docs](https://huan.github.io/flash-store)

* [ECMAScript 6: Maps - 2ality – JavaScript and more](http://2ality.com/2015/01/es6-maps-sets.html)

## SEE ALSO

1. [Node.js databases: an embedded database using LevelDB](https://blog.yld.io/2016/10/24/node-js-databases-an-embedded-database-using-leveldb)
2. [How to Cook a Graph Database in a Night - LevelGraph](http://nodejsconfit.levelgraph.io/)
3. [Graph database JS style for Node.js and the Browser. Built upon LevelUp and LevelDB.](https://github.com/levelgraph/levelgraph)
4. [浅析 Bigtable 和 LevelDB 的实现](http://draveness.me/bigtable-leveldb.html)

## CHANGELOG

### v0.15 master 2019

### v0.14 May 2019

1. Switch from LevelDB to RocksDB [#34](https://github.com/huan/flash-store/issues/34)

### v0.12 Jan 2019

1. Use [level-down](https://github.com/level/leveldown) as backend to skip the compiling when install.
1. Using leveldb official typings from `@types/`

### v0.7 Aug 2018

1. Use [nosql-leveldb](https://github.com/snowyu/node-nosql-leveldb) as backend to prevent segfault.

### v0.6 Jul 2018

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

## FAQ

### Q: What's the difference between the `flash-store` and `memory-card`?

Short answer:
1. `flash-store` is for save data to local flesystem.
1. `memory-card` is for save data to a distributed network storage, it can be serilized/deserilized safely by design.

Long answer:

`flash-store` and `memory-card` are all built by @huan, and they are all follow the ES6 Map API.

`flash-store` is using a no-sql local file database to maximum the performance, it can be used as a local database, or a local cache for whatever you want to catch from a network database.

`memory-card` is using a local file to store data in JSON format by default, however, it supports more distributed methods. Learn more from it's repository at [here](https://github.com/huan/memory-card)

## AUTHOR

[Huan LI (李卓桓)](http://linkedin.com/in/zixia) \<zixia@zixia.net\>

[![Profile of Huan LI (李卓桓) on StackOverflow](https://stackexchange.com/users/flair/265499.png)](https://stackexchange.com/users/265499)

## COPYRIGHT & LICENSE

* Code & Docs © 2017-2019 Huan LI \<zixia@zixia.net\>
* Code released under the Apache-2.0 License
* Docs released under Creative Commons
