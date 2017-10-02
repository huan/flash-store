// https://github.com/Microsoft/TypeScript/issues/14151#issuecomment-280812617
(<any>Symbol).asyncIterator = Symbol.asyncIterator || Symbol.for('Symbol.asyncIterator')

import * as path  from 'path'

import {
  path as appRoot,
}                   from 'app-root-path'
import { log }      from 'brolog'

import * as rimrafProxy     from 'rimraf'
import * as encodingProxy   from 'encoding-down'
import * as leveldownProxy  from 'leveldown'
import * as levelupProxy    from 'levelup'

// https://github.com/rollup/rollup/issues/1267#issuecomment-296395734
const rimraf    = (<any>rimrafProxy).default    || rimrafProxy
const encoding  = (<any>encodingProxy).default  || encodingProxy
const leveldown = (<any>leveldownProxy).default || leveldownProxy
const levelup   = (<any>levelupProxy).default   || levelupProxy

export interface IteratorOptions {
  gt?      : any,
  gte?     : any,
  lt?      : any,
  lte?     : any,
  reverse? : boolean,
  limit?   : number,

  prefix?  : any,
}

export class FlashStore<K, V> {
  private levelDb: any

  constructor(
    public workdir = path.join(appRoot, 'flash-store.workdir'),
  ) {
    log.verbose('FlashStore', 'constructor()')

    // https://twitter.com/juliangruber/status/908688876381892608
    const encoded = encoding(
      leveldown(workdir),
      {
        // FIXME: issue #2
        valueEncoding: 'json',
      },
    )

    this.levelDb = levelup(encoded)
    // console.log((this.levelDb as any)._db.codec)
    this.levelDb.setMaxListeners(17)  // default is Infinity
  }

  public async put(key: K, value: V): Promise<void> {
    log.verbose('FlashStore', 'put(%s, %s) value type: %s', key, value, typeof value)
    // FIXME: issue #2
    return await this.levelDb.put(key, JSON.stringify(value) as any)
  }

  public async get(key: K): Promise<V | null> {
    log.verbose('FlashStore', 'get(%s)', key)
    try {
      // FIXME: issue #2
      return JSON.parse(await this.levelDb.get(key) as any)
    } catch (e) {
      if (/^NotFoundError/.test(e)) {
        return null
      }
      throw e
    }
  }

  public del(key: K): Promise<void> {
    log.verbose('FlashStore', 'del(%s)', key)
    return this.levelDb.del(key)
  }

  public async* keys(options: IteratorOptions = {}): AsyncIterableIterator<K> {
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

    for await (const [key, _] of this.iterator(options)) {
      yield key
    }
  }

  public async* values(options: IteratorOptions = {}): AsyncIterableIterator<V> {
    log.verbose('FlashStore', 'values()')

    // options = Object.assign(options, {
    //   keys   : false,
    //   values : true,
    // })

    for await (const [_, value] of this.iterator(options)) {
      yield value
    }

  }

  public async count(): Promise<number> {
    log.verbose('FlashStore', 'count()')

    let count = 0
    for await (const _ of this) {
      count++
    }
    return count
  }

  public async *iterator(options?: IteratorOptions): AsyncIterableIterator<[K, V]> {
    log.verbose('FlashStore', '*iterator()')

    const iterator = (this.levelDb as any).db.iterator(options)

    while (true) {
      const pair = await new Promise<[K, V] | null>((resolve, reject) => {
        iterator.next(function (err: any , key: K, val: V) {
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

  public async *[Symbol.asyncIterator](): AsyncIterator<[K, V]> {
    log.verbose('FlashStore', '*[Symbol.asyncIterator]()')
    yield* this.iterator()
  }

  public async *streamAsyncIterator(): AsyncIterator<[K, V]> {
    log.warn('FlashStore', 'DEPRECATED *[Symbol.asyncIterator]()')

    const readStream = this.levelDb.createReadStream()

    const endPromise = new Promise<false>((resolve, reject) => {
      readStream
        .once('end',  () => resolve(false))
        .once('error', reject)
    })

    let pair: [K, V] | false

    do {
      const dataPromise = new Promise<[K, V]>(resolve => {
        readStream.once('data', (data: any) => resolve([data.key, data.value]))
      })

      pair = await Promise.race([
        dataPromise,
        endPromise,
      ])

      if (pair) {
        yield pair
      }

    } while (pair)

  }

  public async destroy(): Promise<void> {
    log.verbose('FlashStore', 'destroy()')
    await this.levelDb.close()
    await new Promise(resolve => rimraf(this.workdir, resolve))
  }
}

export default FlashStore
