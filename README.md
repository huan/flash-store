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

Values are serialized with `JSON.stringify` and read back with `JSON.parse`.
This is not a lossless round trip for every JavaScript value: for example,
`Date` becomes a string, `NaN` and infinities become `null`, and properties
whose values are `undefined` are omitted. Top-level `undefined`, circular
objects, and `BigInt` cannot be stored. The TypeScript value type `V` is not
validated against the decoded JSON, so it may not match the runtime value.
Use JSON-compatible values and validate decoded data when its shape matters.

Async iteration uses a snapshot in LMDB key order, not Map insertion order.
`forEach` awaits each callback sequentially and stops on the first error,
rejecting its returned promise. `FlashStoreSync.forEach` remains synchronous.

Iteration accepts `gt`, `gte`, `lt`, `lte`, `reverse`, `limit`, or a string
`prefix`. Do not combine a prefix with range bounds, or two bounds on the same
side. A prefix scan seeks directly to matching string keys and stops after the
last match, so it does not read unrelated entries. `delete` resolves to whether
a key existed.

`close()` waits for outstanding writes. `destroy()` closes and **deletes the
entire database directory**, so use a dedicated directory and never a shared
directory. Both reject on failure.

### `FlashStoreSync`

`FlashStoreSync` maintains a full in-memory Map and writes changes in order in
the background. `set()` and `delete()` validate keys, and `set()` serializes
the value immediately: invalid keys or non-JSON values throw without changing
the cache, and later changes to a stored object are not persisted unless it is
set again. The cache still holds the original object, so it reflects such
changes until reopened. Await `ready()` before reading restored data and to
observe write failures. After a detected write failure, further mutations throw; close
and reopen the store to recover. Mutations queued before the failure is detected
may remain in the cache without being persisted. `close()` and `destroy()` wait
for queued writes and close the database even on failure. `destroy()` removes
the directory only if writes succeeded. Until `ready()` completes, reads and
delete return values only reflect the cache loaded so far.

The cache iterates in its current insertion order, but reopening restores
entries in LMDB key order rather than their original insertion order. Mutations
during restoration may also affect the cache order. The cache holds the values
supplied to it; after reopening, values reflect the JSON round trip above.

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

### Benchmark

Run `npm run benchmark` to compare FlashStore's public API with native LMDB
using 5,000 entries and six paired trials. For example:
`npm run benchmark -- --count 10000 --duration 500 --trials 6 --dir /path/to/disk --memory-dir /dev/shm`.
Duration is the minimum sample length in milliseconds.

The report has three tables:

- **API overhead** runs on memory-backed storage (`/dev/shm` by default on
  Linux) so fsync latency does not hide per-call costs. It measures seeded
  random reads, ordered iteration, and inserts and deletes, sequentially and
  in batches of 32. Reads and scans give every variant the same calibrated
  pass count; mutations repeat insert-then-delete cycles of 50 or 256 absent
  keys until each phase lasts at least `--duration`.
- **Diagnostics** add one FlashStore behavior to native LMDB: an async call
  per read, an async generator per scanned entry, or the conditional
  `remove(key, IF_EXISTS)` that lets `delete()` report whether a key existed
  (a plain `remove()` resolves true even for absent keys). When a variant's
  ratio matches FlashStore's, that behavior explains the overhead. Each row
  also shows FlashStore and native LMDB throughput from the same trials.
- **Durable mutations** run on `--dir` (the OS temporary directory by
  default) with fixed samples: 50 sequential and 256 batched inserts and
  deletes. Commit latency usually dominates, so similar numbers are expected.

When `/dev/shm` is unavailable, the memory mode is skipped; pass
`--memory-dir` to choose another existing directory or `--no-memory` to skip
it. The filesystem type is reported, and only tmpfs or ramfs is labeled as
memory-backed. The memory mode checks free space first; lower `--count` for
small memory filesystems.

Both engines use identical JSON bytes, default durability, and fresh
databases preloaded in an untimed transaction. FlashStore uses its public
async API; LMDB uses synchronous `get()`/`getRange()`, JSON decoding,
asynchronous `put()`, and native `remove()`. This compares usable public APIs,
not identical internal algorithms. Reads and scans are warm-cache
measurements, not cold-storage performance. The first trial warms up and
calibrates reads and scans; each mutation measurement has an untimed warm-up. Full contents and entry
counts are validated outside timing; timed reads and scans consume an
identical checksum, checked afterward.

The output shows median operations/second, reciprocal microseconds/operation
(not latency percentiles), trial ranges, and all sample sizes and durations.
Variants alternate order between trials. Ratios are medians of per-trial
paired ratios. Paired ranges crossing 1 are labeled mixed/tied; ranges are
descriptive, not confidence intervals. With 5,000 cached entries, ratios are
close to worst-case overhead; larger datasets spend more time in LMDB.

Temporary databases are removed after each trial. Results depend on the
machine and filesystem; there are no CI performance thresholds. The default
workload targets less than a minute on the test machine, not on every
filesystem. Run `node --test scripts/benchmark.integration.test.ts` to check
the benchmark CLI, its option validation, and temporary-directory cleanup.

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
