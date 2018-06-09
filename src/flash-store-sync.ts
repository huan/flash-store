import cuid from 'cuid'
import {
  StateSwitch,
}               from 'state-switch'

import {
  log,
}             from './config'

import {
  FlashStore,
}             from './flash-store'

export class BusyMeter {
  private promiseDict: {
    [id: string]: Promise<void>,
  }

  constructor() {
    this.promiseDict = {}
  }

  public async busy(): Promise<boolean> {
    return Reflect.ownKeys(this.promiseDict).length > 0
  }

  public async idle(): Promise<void> {
    return
  }

}

export class FlashStoreSync<K = any, V = any> implements Map<K, V> {

  private cacheMap   : Map<K,        V>
  private flashStore : FlashStore<K, V>

  private asyncBusyState: StateSwitch
  private asyncBusyDict: {
    [id: string]: Promise<void>,
  }

  constructor(
    public workdir?: string,
  ) {
    log.verbose('CacheStore', 'constructor()')

    this.asyncBusyDict = {}
    this.asyncBusyState   = new StateSwitch(workdir, log)

    this.cacheMap   = new Map<K,        V>()
    this.flashStore = new FlashStore<K, V>(workdir)

    this.asyncAddTask(this.loadStoreToCache())

  }

  private async loadStoreToCache(): Promise<void> {
    this.cacheMap.clear()
    for await (const [key, val] of this.flashStore) {
      this.cacheMap.set(key, val)
    }
  }

  private asyncAddTask(future: Promise<void>): void {
    const setBusyWhenPromiseOnFly = () => {
      if (this.asyncBusyState.on()) {
        return
      }
      if (Reflect.ownKeys(this.asyncBusyDict).length > 0) {
        // id/promise exists
        this.asyncBusyState.on(true)
      }
    }

    const unsetBusyWhenNoPromiseOnFly = () => {
      if (this.asyncBusyState.off()) {
        return
      }
      if (Reflect.ownKeys(this.asyncBusyDict).length <= 0) {
        // id/promise all cleared
        this.asyncBusyState.off(true)
      }
    }

    const id = cuid()
    this.asyncBusyDict[id] = new Promise<void>((resolve, reject) => {
      future.then(resolve, reject)
      .finally(() => {
        delete this.asyncBusyDict[id]
        unsetBusyWhenNoPromiseOnFly()
      })
    })
    setBusyWhenPromiseOnFly()
  }

  public async destroy(): Promise<void> {
    this.clear()
    // add destroy task at the end of the event loop
    this.asyncBusyState.ready('off').then(
      () => this.flashStore.destroy(),
    )
  }

  public version(): string {
    return this.flashStore.version()
  }

  /////////////////////////////////////////////////////////
  /**
   *
   *
   * The following methods is all for ES6 Map Interface
   *
   *
   */
  /////////////////////////////////////////////////////////

  public get size(): number {
    return this.cacheMap.size
  }

  get [Symbol.toStringTag]() {
    return 'FlashStoreSync' as any as 'Map'
  }

  public [Symbol.iterator]() {
    return this.cacheMap[Symbol.iterator]()
  }

  public entries() {
    return this.cacheMap.entries()
  }

  public keys() {
    return this.cacheMap.keys()
  }

  public values() {
    return this.cacheMap.values()
  }

  public clear(): void {
    this.asyncAddTask(this.flashStore.clear())
    return this.cacheMap.clear()
  }

  public delete(key: K): boolean {
    this.asyncAddTask(this.flashStore.delete(key))
    return this.cacheMap.delete(key)
  }

  /**
   * Do not mutate the key/value in the forEach loop!
   */
  public forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
    /**
     * 1. no need to call flashStore
     * 2. callbackfn should not mutate the data, or the data will be lost sync between cache & store
     */
    return this.cacheMap.forEach(callbackfn, thisArg)
  }

  public get(key: K): V | undefined {
    return this.cacheMap.get(key)
  }

  public has(key: K): boolean {
    return this.cacheMap.has(key)
  }

  public set(key: K, value: V): this {
    this.asyncAddTask(this.flashStore.set(key, value))
    this.cacheMap.set(key, value)
    return this
  }

}

export default FlashStoreSync
