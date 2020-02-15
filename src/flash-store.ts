import path  from 'path'
import fs from 'fs'
import { flockSync } from 'fs-ext'

import {
  path as appRoot,
}                   from 'app-root-path'

import rimraf    from 'rimraf'
import encoding  from 'encoding-down'
import levelup   from 'levelup'
import MedeaDown from 'medeadown'

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

  private levelDb: any
  private medeaKeyDir: Map<any, any>
  private lockFd: number

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
    public workdir?: string,
  ) {

    if (!this.workdir) {
      this.workdir = path.join(appRoot, '.flash-store')
    }

    if (fs.existsSync(this.workdir)) {
      log.verbose('FlashStore', 'constructor(%s)', workdir)
    } else {
      /**
        * Mkdir for the database directory. (only for the last path, no recursive)
        */
      log.silly('FlashStore', 'constructor(%s) not exist, creating...', this.workdir)
      try {
        fs.mkdirSync(this.workdir)
      } catch (e) {
        log.error('FlashStore', 'constructor(%s) exception: %s', this.workdir, e && e.message)
        throw e
      }
      log.silly('FlashStore', 'constructor(%s) workdir created.', this.workdir)
    }

    const lockFile = path.join(
      this.workdir,
      'flash-store.lock',
    )

    this.lockFd = fs.openSync(lockFile, 'w')
    try {
      flockSync(this.lockFd, 'exnb')
    } catch (e) {
      log.error('FlashStore', 'constructor() workdir("%s") is busy: maybe there another FlashStore are using it?', this.workdir)
      throw e
    }

    // we use seperate workdir for snapdb, leveldb, and rocksdb etc.
    const medeaWorkdir = path.join(this.workdir, 'medea')

    const medeaDown = MedeaDown(medeaWorkdir)
    this.medeaKeyDir = medeaDown.db.keydir

    // https://twitter.com/juliangruber/status/908688876381892608
    const encoded = encoding(
      // leveldown(workdir),
      medeaDown,
      {
        // FIXME: issue #2
        valueEncoding: 'json',
      },
    )

    this.levelDb = levelup(encoded)
    // console.log((this.levelDb as any)._db.codec)
    this.levelDb.setMaxListeners(17)  // default is Infinity
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
  public async set (key: K, value: V): Promise<void> {
    log.verbose('FlashStore', 'set(%s, %s) value type: %s', key, JSON.stringify(value), typeof value)
    await this.levelDb.put(key, JSON.stringify(value))
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
      return JSON.parse(await this.levelDb.get(key))
    } catch (e) {
      if (/^NotFoundError/.test(e)) {
        // The leveldb will throw NotFoundError for non-exist keys
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
  public async delete (key: K): Promise<void> {
    log.verbose('FlashStore', 'delete(%s)', key)
    await this.levelDb.del(key)
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

    let future = Promise.resolve() as any

    /**
     * the size will be zero if there's never a put/get operation
     *  because I guess that it was lazy initialized.
     */
    if (this.medeaKeyDir.size === 0) {
      future = future.then(() => this.get('foobar' as any))
    }
    return future.then(() => this.medeaKeyDir.size)

    // // TODO: is there a better way to count all items from the db?
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

    const iterator = (this.levelDb as any).db.iterator(options)

    while (true) {
      const pair = await new Promise<[K, V] | null>((resolve, reject) => {
        iterator.next(function (err: any, key: K, val: V) {
          if (err) {
            reject(err)
          }
          if (!key && !val) {
            return resolve(null)
          }
          if (val) {
            // FIXME: issue #2
            val = JSON.parse(val as any)
          }
          return resolve([key, val])
        })
      })
      if (!pair) {
        break
      }
      yield pair
    }
  }

  public async * [Symbol.asyncIterator] (): AsyncIterableIterator<[K, V]> {
    log.verbose('FlashStore', '*[Symbol.asyncIterator]()')
    yield * this.entries()
  }

  // /**
  //  * @private
  //  * @deprecated
  //  */
  // public async * streamAsyncIterator (): AsyncIterator<[K, V]> {
  //   log.warn('FlashStore', 'DEPRECATED *[Symbol.asyncIterator]()')

  //   const readStream = this.levelDb.createReadStream()

  //   const endPromise = new Promise<false>((resolve, reject) => {
  //     readStream
  //       .once('end',  () => resolve(false))
  //       .once('error', reject)
  //   })

  //   let pair: [K, V] | false

  //   do {
  //     const dataPromise = new Promise<[K, V]>(resolve => {
  //       readStream.once('data', (data: any) => resolve([data.key, data.value]))
  //     })

  //     pair = await Promise.race([
  //       dataPromise,
  //       endPromise,
  //     ])

  //     if (pair) {
  //       yield pair
  //     }

  //   } while (pair)

  // }

  /**
   * FlashStore will not be able to be used anymore after it has been closed.
   */
  public async close (): Promise<void> {
    log.verbose('FlashStore', 'close()')
    await this.levelDb.close()

    if (this.lockFd !== 0) {
      flockSync(this.lockFd, 'un')
      fs.closeSync(this.lockFd)
      this.lockFd = 0
    }
  }

  /**
   * Destroy the database
   *
   * @returns {Promise<void>}
   */
  public async destroy (): Promise<void> {
    log.verbose('FlashStore', 'destroy()')
    await this.levelDb.close()
    await new Promise(resolve => rimraf(this.workdir!, resolve))
  }

}

export default FlashStore
