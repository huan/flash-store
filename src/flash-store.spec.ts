#!/usr/bin/env ts-node
import fs    from 'fs'
import os    from 'os'
import path  from 'path'

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
      /* eslint @typescript-eslint/no-unused-vars: off */
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

// TODO: wait https://github.com/ClickSimply/snap-db/pull/12
test('set the same key more than one time, and the size should be 1', async t => {
  for await (const store of storeFixture()) {
    await store.set(KEY, VAL)
    await store.set(KEY, VAL)
    await store.set(KEY, VAL)
    const size = await store.size
    t.equal(size, 1, 'the size should be 1')
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

test('close() twice gracefully', async t => {
  // https://github.com/ClickSimply/snap-db/issues/10
  for await (const store of storeFixture()) {
    try {
      await store.close()
      await store.close()
      // console.info(store)
      t.pass('close() can be invoked more than one times')
    } catch (e) {
    // console.info('wtf?', e || 'rejection')
      t.fail(e || 'rejection')
    }
  }
  // t.pass('end')
  // console.info('haha')
})

test('first time size', async t => {
  for await (const store of storeFixture()) {
    try {
      const workdir = store.workdir
      await store.set('foo', 'bar')
      await store.close()

      const oldStore = new FlashStore(workdir)
      t.equal(await oldStore.size, 1, 'should get size 1 after re-open a old store.')
    } catch (e) {
    // console.info('wtf?', e || 'rejection')
      t.fail(e || 'rejection')
    }
  }
  // t.pass('end')
  // console.info('haha')
})

// To be fixed: https://github.com/huan/flash-store/issues/4
test.skip('values({ optioin: gte/lte })', async t => {
  for await (const store of storeFixture()) {
    try {
      await store.set('a', 3)
      await store.set('b', 5)

      for await (const value of store.values({ gte: 4 })) {
        t.equal(value, 5, 'gte 4 should get 5')
      }

      for await (const value of store.values({ lte: 4 })) {
        t.equal(value, 4, 'lte 4 should get 4')
      }

    } catch (e) {
      t.fail(e || 'rejection')
    }
  }
})

test('create workdir if it is not exist', async t => {
  const tmpDir = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      path.sep,
      'flash-store-',
    ),
  )

  const notExistWorkDir = path.join(
    tmpDir,
    'not-exist-dir',
  )
  const store = new FlashStore(notExistWorkDir)

  const KEY = 'life'
  const VAL = 42

  await store.set(KEY, VAL)
  const val = await store.get(KEY)

  t.equal(val, VAL, 'should work without problem with a not existing workdir by creating it automatically.')

  await store.destroy()
})

test('Only one instance can use the database directory', async t => {
  for await (const store of storeFixture()) {
    try {
      const workdir = store.workdir

      /**
       * We have to active the store becasue the medae is lazy initializing.
       */
      await store.size

      try {
        const anotherStore = new FlashStore(workdir)
        void anotherStore
        t.fail('should not be instanciated because the workdir is busy.')
      } catch (e) {
        t.pass('should throw if another store has already been using the workdir')
      }

    } catch (e) {
      t.fail(e || 'rejection')
    }
  }
})

test('compact()', async t => {
  for await (const store of storeFixture()) {
    try {
      await store.size
      const db = (store as any).levelDb.db.db.db
      await new Promise((resolve, reject) => {
        db.compact((err: any) => {
          if (err) {
            return reject(err)
          }
          resolve()
        })
      })

      t.pass('compacted')
    } catch (e) {
      t.fail(e)
    }
  }
})

/**
 * Fixtures
 */

async function * storeFixture () {
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
