#!/usr/bin/env ts-node
import * as fs    from 'fs'
import * as os    from 'os'
import * as path  from 'path'

// tslint:disable:no-shadowed-variable
import * as test from 'blue-tape'

// import { log }    from './config'
// log.level('silly')

import { FlashStore }  from './flash-store'

const KEY = 'test-key'
const VAL = 'test-val'

test('constructor()', async t => {
  const tmpDir = path.join(
    os.tmpdir(),
    `flash-store.${process.pid}`,
  )
  t.doesNotThrow(async () => {
    const store = new FlashStore(tmpDir)

    // need to do something to create the db directory
    await store.del('init')

    t.ok(fs.existsSync(tmpDir), 'should create the workDir')
    store.destroy()
  }, 'should not throw exception with a non existing workDir')
})

test('Store as iterator', async t => {

  t.test('async iterator for empty store', async t => {
    for await (const store of storeFixture()) {
      let n = 0
      for await (const _ of store) {
        n++
        break
      }
      t.equal(n, 0, 'should get empty iterator')
    }
  })

  t.test('async iterator', async t => {
    for await (const store of storeFixture()) {
      await store.put(KEY, VAL)
      let n = 0
      for await (const [key, val] of store) {
        t.equal(key, KEY, 'should get key back')
        t.equal(val, VAL, 'should get val back')
        n++
      }
      t.equal(n, 1, 'should iterate once')
    }
  })

})

test('get()', async t => {
  for await (const store of storeFixture()) {
    let val = await store.get(KEY)
    t.equal(val, null, 'should get null for not exist key')

    await store.put(KEY, VAL)
    val = await store.get(KEY)
    t.equal(val, VAL, 'should get VAL after set KEY')
  }
})

test('put()', async t => {
  for await (const store of storeFixture()) {
    await store.put(KEY, VAL)
    const val = await store.get(KEY)
    t.equal(val, VAL, 'should put VAL for KEY')
  }
})

test('count()', async t => {
  for await (const store of storeFixture()) {
    let count = await store.count()
    t.equal(count, 0, 'should get count 0 after init')
    await store.put(KEY, VAL)
    count = await store.count()
    t.equal(count, 1, 'should get count 1 after put')
  }
})

test('keys()', async t => {
  for await (const store of storeFixture()) {
    let count = 0
    for await (const _ of store.keys()) {
      count++
    }
    t.equal(count, 0, 'should get 0 key after init')

    await store.put(KEY, VAL)

    for await (const key of store.keys()) {
      t.equal(key, KEY, 'should get back the key')
      count++
    }
    t.equal(count, 1, 'should get 1 key after 1 put')
  }
})

test('values()', async t => {
  for await (const store of storeFixture()) {
    let count = 0
    for await (const _ of store.values()) {
      count++
    }
    t.equal(count, 0, 'should get 0 value after init')

    await store.put(KEY, VAL)

    for await (const value of store.values()) {
      t.equal(value, VAL, 'should get back the value')
      count++
    }
    t.equal(count, 1, 'should get 1 value after 1 put')
  }
})

async function* storeFixture() {
  const tmpDir = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      path.sep,
      'flash-store-',
    ),
  )
  const store = new FlashStore(tmpDir)

  yield store

  await store.destroy()
}
