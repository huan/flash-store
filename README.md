# FLASH-STORE

[![Powered by LevelDB](https://img.shields.io/badge/Powered%20By-LevelDB-green.svg)](https://leveldb.org/) [![Powered by TypeScript](https://img.shields.io/badge/Powered%20By-TypeScript-blue.svg)](https://www.typescriptlang.org/) 

[![Build Status](https://travis-ci.org/zixia/flash-store.svg?branch=master)](https://travis-ci.org/zixia/flash-store) [![NPM Version](https://badge.fury.io/js/flash-store.svg)](https://badge.fury.io/js/flash-store) [![Downloads](http://img.shields.io/npm/dm/flash-store.svg?style=flat-square)](https://npmjs.org/package/flash-store) [![node](https://img.shields.io/node/v/flash-store.svg?maxAge=604800)](https://nodejs.org/)

FlashStore is a Key-Value database tool and makes using leveldb more easy for Node.js

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
const flashStore = new FlashStore('falshstore.workdir')
await flashStore.put(1, 'a')
console.log(`key: 1, value: ${await flashStore.get(1)}`)
await flashStore.del(1)
console.log(`key: 1, value: ${await flashStore.get(1)}`)
```

## DOCUMENT

See [auto generated docs](https://zixia.github.io/flash-store)

## SEE ALSO

1. [Node.js databases: an embedded database using LevelDB](https://blog.yld.io/2016/10/24/node-js-databases-an-embedded-database-using-leveldb)
1. [How to Cook a Graph Database in a Night - LevelGraph](http://nodejsconfit.levelgraph.io/)
1. [Graph database JS style for Node.js and the Browser. Built upon LevelUp and LevelDB.](https://github.com/levelgraph/levelgraph)
1. [浅析 Bigtable 和 LevelDB 的实现](http://draveness.me/bigtable-leveldb.html)

## CHANGELOG

### v0.4 master (Jun 2018)

1. Update the API to ES6 `Map`-like, the difference is that FlashStore is all **async**.

### v0.2 2017

Init version, API is LevelDB like.

## AUTHOR

Huan LI \<zixia@zixia.net\> (http://linkedin.com/in/zixia)

<a href="http://stackoverflow.com/users/1123955/zixia">
  <img src="http://stackoverflow.com/users/flair/1123955.png" width="208" height="58" alt="profile for zixia at Stack Overflow, Q&amp;A for professional and enthusiast programmers" title="profile for zixia at Stack Overflow, Q&amp;A for professional and enthusiast programmers">
</a>

## COPYRIGHT & LICENSE

* Code & Docs © 2017 Huan LI \<zixia@zixia.net\>
* Code released under the Apache-2.0 License
* Docs released under Creative Commons
