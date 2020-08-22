import path  from 'path'
import fs from 'fs'

import { AsyncMapLike } from 'async-map-like'
import appRoot from 'app-root-path'

import rimraf    from 'rimraf'

import SQLite from 'better-sqlite3'

import {
  log,
  VERSION,
}             from './config'

export interface IteratorOptions {
  gt?      : any,
  gte?     : any,
  lt?      : any,
  lte?     : any,
  reverse? : boolean,
  limit?   : number,

  prefix?  : any,
}

interface FlashSqlite {
  db: SQLite.Database,

  stmtCount   : SQLite.Statement,
  stmtDel     : SQLite.Statement,
  stmtDelAll  : SQLite.Statement,
  stmtGet     : SQLite.Statement,
  stmtSet     : SQLite.Statement,
  stmtIterate : SQLite.Statement,
}

type K = string

export class FlashStore<V extends Object> implements AsyncMapLike<K, V> {

  private flashSqlite: FlashSqlite

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
    public workdir = path.join(appRoot.path, '.flash-store'),
  ) {
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

    // we use seperate workdir for snapdb, leveldb, and rocksdb etc.
    const sqliteFile = path.join(this.workdir, 'sqlite.db')
    this.flashSqlite = this.initSqlite(sqliteFile)
  }

  private initSqlite (file: string): FlashSqlite {
    log.verbose('FlashStore', 'initSqlite(%s)', file)

    const db = new SQLite(file)

    const sql = `
      CREATE TABLE IF NOT EXISTS store (
        key TEXT NOT NULL,
        val TEXT NOT NULL,
        PRIMARY KEY(key)
      ) WITHOUT ROWID;
    `

    db.exec(sql)

    const onExitClose = () => db && db.open && db.close()
    process.on('exit', onExitClose)

    const stmtCount  = db.prepare('SELECT COUNT(*) FROM store').pluck()
    const stmtDel    = db.prepare('DELETE FROM store WHERE key = ?')
    const stmtDelAll = db.prepare('DELETE FROM store')
    const stmtGet    = db.prepare<[K]>('SELECT val FROM store WHERE key = ?').pluck()
    const stmtSet    = db.prepare<[V, K]>(`
      INSERT INTO store (key, val)
      VALUES ($key, $val)
      ON CONFLICT(key) DO UPDATE SET val = $val
    `)
    const stmtIterate = db.prepare('SELECT key, val FROM store').raw()

    return {
      db,
      stmtCount,
      stmtDel,
      stmtDelAll,
      stmtGet,
      stmtIterate,
      stmtSet,
    }
  }

  static VERSION = VERSION

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
  public async set (key: K, value: V): Promise<this> {
    log.verbose('FlashStore', 'set(%s, %s) value type: %s', key, JSON.stringify(value), typeof value)
    // await this.db.put(key, JSON.stringify(value))
    const result = this.flashSqlite.stmtSet.run({
      key,
      val: JSON.stringify(value),
    })
    if (result.changes !== 1) {
      throw new Error('set fail!')
    }
    return this
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
    const value = this.flashSqlite.stmtGet.get(key)
    return value && JSON.parse(value) as any
  }

  /**
   * Del data by key
   *
   * @param {K} key
   * @returns {Promise<void>}
   * @example
   * await flashStore.delete(1)
   */
  public async delete (key: K): Promise<boolean> {
    log.verbose('FlashStore', 'delete(%s)', key)
    this.flashSqlite.stmtDel.run(key)
    return true
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

    const num: number = this.flashSqlite.stmtCount.get()
    return Promise.resolve(num)
  }

  /**
   */
  public async has (key: K): Promise<boolean> {
    const val = await this.get(key)
    return !!val
  }

  /**
   */
  public async clear (): Promise<void> {
    this.flashSqlite.stmtDelAll.run()
  }

  /**
   * @private
   */
  public async * entries (options?: IteratorOptions): AsyncIterableIterator<[K, V]> {
    log.verbose('FlashStore', '*entries(%s)', JSON.stringify(options))

    for (const [key, val] of this.flashSqlite.stmtIterate.iterate()) {
      yield [key, JSON.parse(val)]
    }
  }

  async forEach (
    callbackfn: (
      value: V,
      key: string,
      map: any,
    ) => void,
    thisArg?: any,
  ): Promise<void> {
    for await (const [key, value] of this.entries()) {
      callbackfn.call(thisArg, value, key, this)
    }
  }

  public async * [Symbol.asyncIterator] (): AsyncIterableIterator<[K, V]> {
    log.verbose('FlashStore', '*[Symbol.asyncIterator]()')
    yield * this.entries()
  }

  /**
   * FlashStore will not be able to be used anymore after it has been closed.
   */
  public async close (): Promise<void> {
    log.verbose('FlashStore', 'close()')
    await this.flashSqlite.db.close()
  }

  /**
   * Destroy the database
   *
   * @returns {Promise<void>}
   */
  public async destroy (): Promise<void> {
    log.verbose('FlashStore', 'destroy()')
    await this.close()
    await new Promise(resolve => rimraf(this.workdir!, resolve))
  }

}

export default FlashStore
