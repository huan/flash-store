import {
  FlashStore,
  FlashStoreSync,
}                   from 'flash-store'

const store = new FlashStore()
store.destroy()

const storeSync = new FlashStoreSync()
storeSync.destroy()

console.log(`Smoke Testing v${store.version()} PASSED!`)
