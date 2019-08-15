import * as path  from 'path'

import {
  path as appRoot,
}                   from 'app-root-path'

import rimraf     from 'rimraf'
// import encoding   from 'encoding-down'
// import leveldown from 'leveldown'
// import rocksdb    from 'rocksdb'
// import levelup    from 'levelup'
import { SnapDB } from 'snap-db'

import {
  log,
  VERSION,
}             from './config'

import {
  AsyncMap,
}             from './async-map'

export interface IteratorOptions {
  gt?      : any,
  gte?     : any,
  lt?      : any,
  lte?     : any,
  reverse? : boolean,
  limit?   : number,

  prefix?  : any,
}

export class FlashStore<K = string, V = any> implements AsyncMap<K, V> {
  private snapDb: SnapDB<string>

  /**
   * FlashStore is a Key-Value database tool and makes using leveldb more easy for Node.js
   *
   * Creates an instance of FlashStore.
   * @param {string} [workdir=path.join(appRoot, 'flash-store.workdir')]
   * @example
   * import { FlashStore } from 'flash-store'
   * const flashStore = new FlashStore('flashstore.workdir')
   */
  constructor (
    public workdir = path.join(appRoot, '.flash-store'),
  ) {
    log.verbose('FlashStore', 'constructor()')

    // https://twitter.com/juliangruber/status/908688876381892608
    // const encoded = encoding(
    //   // leveldown(workdir),
    //   rocksdb(workdir),
    //   {
    //     // FIXME: issue #2
    //     valueEncoding: 'json',
    //   },
    // )

    // this.levelDb = levelup(encoded)
    // // console.log((this.levelDb)._db.codec)
    // this.levelDb.setMaxListeners(17)  // default is Infinity

    this.snapDb = new SnapDB({
      dir: workdir, // database folder
      key: 'string', // key type, can be "int", "string" or "float"
    })
  }

  public version (): string {
    return VERSION
  }

  /**
   * Set data in database
   *
   * @param {K} key
   * @param {V} value
   * @returns {Promise<void>}
   * @example
   * await flashStore.set(1, 1)
   */
  public async set(key: K, value: V): Promise<void> {
    log.verbose('FlashStore', 'set(%s, %s) value type: %s', key, value, typeof value)
    // FIXME: string for SnapDB only
    if (typeof key !== 'string') {
      throw new Error('only support string as key')
    }
    await this.snapDb.put(key, JSON.stringify(value))
  }

  /**
   * Get value from database by key
   *
   * @param {K} key
   * @returns {(Promise<V | null>)}
   * @example
   * console.log(await flashStore.get(1))
   */
  public async get (key: K): Promise<V | undefined> {
    log.verbose('FlashStore', 'get(%s)', key)
    try {
      // FIXME: string for SnapDB only
      if (typeof key !== 'string') {
        throw new Error('only support string as key')
      }
      const val = await this.snapDb.get(key)
      return val && JSON.parse(val)
    } catch (e) {
      if (/^NotFoundError/.test(e)) {
        return undefined
      }
      throw e
    }
  }

  /**
   * Del data by key
   *
   * @param {K} key
   * @returns {Promise<void>}
   * @example
   * await flashStore.delete(1)
   */
  public async delete(key: K): Promise<void> {
    log.verbose('FlashStore', 'delete(%s)', key)
    // FIXME: string for SnapDB only
    if (typeof key !== 'string') {
      throw new Error('only support string as key')
    }
    await this.snapDb.delete(key)
  }

  /**
   * @typedef IteratorOptions
   *
   * @property { any }      gt       - Matches values that are greater than a specified value
   * @property { any }      gte      - Matches values that are greater than or equal to a specified value.
   * @property { any }      lt       - Matches values that are less than a specified value.
   * @property { any }      lte      - Matches values that are less than or equal to a specified value.
   * @property { boolean }  reverse  - Reverse the result set
   * @property { number }   limit    - Limits the number in the result set.
   * @property { any }      prefix   - Make the same prefix key get together.
   */

  /**
   * Find keys by IteratorOptions
   *
   * @param {IteratorOptions} [options={}]
   * @returns {AsyncIterableIterator<K>}
   * @example
   * const flashStore = new FlashStore('flashstore.workdir')
   * for await(const key of flashStore.keys({gte: 1})) {
   *   console.log(key)
   * }
   */
  public async * keys (options: IteratorOptions = {}): AsyncIterableIterator<K> {
    log.verbose('FlashStore', 'keys()')

    // options = Object.assign(options, {
    //   keys   : true,
    //   values : false,
    // })

    if (options.prefix) {
      if (options.gte || options.lte) {
        throw new Error('can not specify `prefix` with `gte`/`lte` together.')
      }
      options.gte = options.prefix
      options.lte = options.prefix + '\xff'
    }

    for await (const [key] of this.entries(options)) {
      yield key
    }
  }

  /**
   * Find all values
   *
   * @returns {AsyncIterableIterator<V>}
   * @example
   * const flashStore = new FlashStore('flashstore.workdir')
   * for await(const value of flashStore.values()) {
   *   console.log(value)
   * }
   */
  public async * values (options: IteratorOptions = {}): AsyncIterableIterator<V> {
    log.verbose('FlashStore', 'values()')

    // options = Object.assign(options, {
    //   keys   : false,
    //   values : true,
    // })

    for await (const [, value] of this.entries(options)) {
      yield value
    }

  }

  /**
   * Get the size of the database
   * @returns {Promise<number>}
   * @example
   * const size = await flashStore.size
   * console.log(`database size: ${size}`)
   */
  public get size (): Promise<number> {
    log.verbose('FlashStore', 'size()')

    // TODO: is there a better way to count all items from the db?
    // return new Promise<number>(async (resolve, reject) => {
    //   try {
    //     let count = 0
    //     for await (const _ of this) {
    //       count++
    //     }
    //     resolve(count)
    //   } catch (e) {
    //     reject(e)
    //   }
    // })
    return this.snapDb.getCount()
  }

  /**
   * FIXME: use better way to do this
   */
  public async has (key: K): Promise<boolean> {
    const val = await this.get(key)
    return !!val
  }

  /**
   * TODO: use better way to do this with leveldb
   */
  public async clear (): Promise<void> {
    for await (const key of this.keys()) {
      await this.delete(key)
    }
  }

  /**
   * @private
   */
  public async * entries (options?: IteratorOptions): AsyncIterableIterator<[K, V]> {
    log.verbose('FlashStore', '*entries(%s)', JSON.stringify(options))

    const iterator = await this.snapDb.getAllIt()

    for await (const [key, val] of iterator) {
      const valObj = JSON.parse(val)
      // FIXME: key has to be string for SnapDB
      yield [key as any, valObj]
    }

    // const iterator = (this.db).db.iterator(options)

    // while (true) {
    //   const pair = await new Promise<[K, V] | null>((resolve, reject) => {
    //     iterator.next(function (err: any , key: K, val: V) {
    //       if (err) {
    //         reject(err)
    //       }
    //       if (!key && !val) {
    //         return resolve(null)
    //       }
    //       if (val) {
    //         // FIXME: string for SnapDB only
    //         if (typeof val !== 'string') {
    //           throw new Error('only support string as val')
    //         }
    //         val = JSON.parse(val)
    //       }
    //       return resolve([key, val])
    //     })
    //   })
    //   if (!pair) {
    //     break
    //   }
    //   yield pair
    // }
  }

  public async * [Symbol.asyncIterator] (): AsyncIterableIterator<[K, V]> {
    log.verbose('FlashStore', '*[Symbol.asyncIterator]()')
    yield * this.entries()
  }

  public async close(): Promise<void> {
    log.verbose('FlashStore', 'close()')
    await this.snapDb.close()
  }

  /**
   * Destroy the database
   *
   * @returns {Promise<void>}
   */
  public async destroy (): Promise<void> {
    log.verbose('FlashStore', 'destroy()')
    await this.snapDb.close()
    await new Promise(resolve => rimraf(this.workdir, resolve))
  }

}

export default FlashStore
