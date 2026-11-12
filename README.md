# flash-store

<!-- markdownlint-disable MD013 -->

[![Powered by LMDB](https://img.shields.io/badge/Powered%20By-LMDB-green.svg)](https://github.com/kriszyp/lmdb-js)
[![Powered by TypeScript](https://img.shields.io/badge/Powered%20By-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![ES Modules](https://img.shields.io/badge/ES-Modules-brightgreen)](https://github.com/Chatie/tsconfig/issues/16)

[![NPM Version](https://img.shields.io/npm/v/flash-store?color=brightgreen)](https://www.npmjs.com/package/flash-store)
[![npm (next)](https://img.shields.io/npm/v/flash-store/next.svg)](https://www.npmjs.com/package/flash-store?activeTab=versions)
[![GitHub Action](https://github.com/huan/flash-store/workflows/NPM/badge.svg)](https://github.com/huan/flash-store/actions?query=workflow%3ANPM)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Downloads](http://img.shields.io/npm/dm/flash-store.svg?style=flat-square)](https://npmjs.org/package/flash-store)
[![node](https://img.shields.io/node/v/flash-store.svg?maxAge=604800)](https://nodejs.org/)

FlashStore is persistent key-value storage with asynchronous and synchronous Map-like APIs, powered by LMDB.

![flash store](https://huan.github.io/flash-store/images/flash-store.png)

## Requirements

Node.js 26 or newer and npm 11 or newer. The npm package is ESM-only.

## Examples

Try the following command

```shell
npm install
npm run demo
```

The basic function as follows:

```ts
import { FlashStore } from 'flash-store'

const flashStore = new FlashStore('flashstore.workdir')

await flashStore.set(1, 'a')
console.log(`key: 1, value: ${await flashStore.get(1)}`)
// Output: 'a'

await flashStore.delete(1)
console.log(`key: 1, value: ${await flashStore.get(1)}`)
// Output: undefined
await flashStore.close()
```

## API Reference

### `FlashStore`

`FlashStore` provides async `set`, `get`, `has`, `delete`, `clear`, `forEach`,
and `size`, plus async iteration through `entries`, `keys`, and `values`.
Keys are finite numbers or strings without null characters; values use JSON
serialization. Numeric keys sort naturally before strings. LMDB imposes a
maximum encoded key size. See the [LMDB documentation](https://github.com/kriszyp/lmdb-js#keys).

Iteration accepts `gt`, `gte`, `lt`, `lte`, `reverse`, `limit`, or a string
`prefix`. Do not combine a prefix with range bounds, or two bounds on the same
side. `delete` resolves to whether a key existed.

`close()` waits for outstanding writes. `destroy()` closes and **deletes the
entire database directory**, so use a dedicated directory and never a shared
directory. Both reject on failure.

### `FlashStoreSync`

`FlashStoreSync` maintains a full in-memory Map and writes changes in order in
the background. Await `ready()` before reading restored data and to observe
write failures. `close()` and `destroy()` wait for queued writes and reject on
failure. Until `ready()` completes, reads and delete return values only reflect
the cache loaded so far.

## Diagnostics

The `flash-store.operation` Node diagnostics channel publishes `{ operation }`
after successful `set`, `delete`, and `clear` operations. Messages contain no
keys, values, or paths. The existing exported `log` remains available; its
configured log level determines what application data it logs.

## Development

Node executes TypeScript directly; `npm test` performs type-checking, Biome
checks, and Node tests without building. `npm run test:deno` runs the same unit
tests on Deno. `npm run coverage:node` and `npm run coverage:deno` enforce
independently measured baselines and generate local reports. `npm run test:pack`
builds the package and verifies it in an isolated npm consumer.

## Document

See the [documentation](https://huan.github.io/flash-store).

* [ECMAScript 6: Maps - 2ality – JavaScript and more](http://2ality.com/2015/01/es6-maps-sets.html)

## Version History

### v2.0

1. LMDB-backed storage, ESM-only packaging, and Node.js 26.

## FAQ

### Q: What's the difference between the `flash-store` and `memory-card`

Short answer:

1. `flash-store` is for save data to local filesystem.
1. `memory-card` is for save data to a distributed network storage, it can be serialized/deserialized safely with the minimum payload transfered by design.

Long answer:

`flash-store` and `memory-card` are all built by @huan, and they are all follow the ES6 Map API.

`flash-store` is using a no-sql local file database to maximum the performance, it can be used as a local database, or a local cache for whatever you want to cache from other API.

`memory-card` is using a local file to store data in JSON format by default, however, it supports more distributed methods and it can be serialized/deserialized safely with the minimum payload for transfer the data between networks (for example, it can serialize itself to only include the `redis` config and then deserialize it to restore a MemoryCard instance with the same data backend). Learn more from it's repository at [here](https://github.com/huan/memory-card)

## Author

[Huan LI](https://github.com/huan) ([Huan Li](http://linkedin.com/in/huan42)) huan@chatie.io

[![Profile of Huan Li on StackOverflow](https://stackexchange.com/users/flair/265499.png)](https://stackexchange.com/users/265499)

## Copyright & License

* Code & Docs © 2017-now Huan Li \<huan@chatie.io\>
* Code released under the Apache-2.0 License
* Docs released under Creative Commons
