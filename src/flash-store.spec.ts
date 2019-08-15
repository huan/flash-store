#!/usr/bin/env ts-node
import fs    from 'fs'
import os    from 'os'
import path  from 'path'

// import rimraf from 'rimraf'

// tslint:disable:no-shadowed-variable
import test from 'blue-tape'

// import { log }    from './config'
// log.level('silly')

import {
  FlashStore,
}               from './flash-store'

const KEY     = 'test-key'
const VAL     = 'test-val'
const VAL_OBJ = { obj_key: 'obj_val' }

test('constructor()', async t => {
  const tmpDir = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      path.sep,
      'flash-store-',
    ),
  )

  t.doesNotThrow(async () => {
    const store = new FlashStore(tmpDir)

    // need to do something to create the db directory
    await store.delete('init')

    t.ok(fs.existsSync(tmpDir), 'should create the workDir')
    await store.destroy()
  }, 'should not throw exception with a non existing workDir')

})

test('version()', async t => {
  for await (const store of storeFixture()) {
    t.ok(store.version().match(/^\d+\.\d+\.\d+$/), 'should get semver version')
  }
})

test('Store as async iterator', async t => {

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
      await store.set(KEY, VAL)
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

test('async get()', async t => {
  t.test('return undefined for non existing key', async t => {
    for await (const store of storeFixture()) {
      const val = await store.get(KEY)
      t.equal(val, undefined, 'should get undefined for not exist key')
    }
  })

  t.test('store string key/val', async t => {
    for await (const store of storeFixture()) {
      await store.set(KEY, VAL)
      const val = await store.get(KEY)
      t.equal(val, VAL, 'should get VAL after set KEY')
    }
  })

  t.test('store object value', async t => {
    for await (const store of storeFixture()) {
      await store.set(KEY, VAL_OBJ)
      const val = await store.get(KEY)
      t.deepEqual(val, VAL_OBJ, 'should get VAL_OBJ after set KEY')
    }
  })
})

test('async set()', async t => {
  for await (const store of storeFixture()) {
    await store.set(KEY, VAL)
    const val = await store.get(KEY)
    t.equal(val, VAL, 'should set VAL for KEY')
  }
})

test('async size()', async t => {
  for await (const store of storeFixture()) {
    let size = await store.size
    t.equal(size, 0, 'should get size 0 after init')
    await store.set(KEY, VAL)
    size = await store.size
    t.equal(size, 1, 'should get count 1 after put')
  }
})

test('async keys()', async t => {
  for await (const store of storeFixture()) {
    let count = 0
    for await (const _ of store.keys()) {
      count++
    }
    t.equal(count, 0, 'should get 0 key after init')

    await store.set(KEY, VAL)
    for await (const key of store.keys()) {
      t.equal(key, KEY, 'should get back the key')
      count++
    }
    t.equal(count, 1, 'should get 1 key after 1 put')
  }
})

test('async values()', async t => {
  for await (const store of storeFixture()) {
    let count = 0
    for await (const _ of store.values()) {
      count++
    }
    t.equal(count, 0, 'should get 0 value after init')

    await store.set(KEY, VAL)

    for await (const value of store.values()) {
      t.equal(value, VAL, 'should get back the value')
      count++
    }
    t.equal(count, 1, 'should get 1 value after 1 put')
  }
})

test.only('close()', async t => {
  for await (const store of storeFixture()) {
    console.info('HERE')
    t.pass('there')
    try {
      await store.close()
      await store.close()
      console.info('wtf')
      t.pass('close() can be invoked more than one times')
    } catch (e) {
      console.info('wtf?')
      t.fail(e)
    }
  }
})

/**
 * Fixtures
 */

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
