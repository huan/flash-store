import {
  VERSION,
  FlashStore,
  FlashStoreSync,
}                   from 'flash-store'

const store = new FlashStore()
store.destroy()

const storeSync = new FlashStoreSync()
storeSync.destroy()

if (VERSION === '0.0.0') {
  throw new Error('version should be set before publishing')
}

console.log(`Smoke Testing v${store.version()} PASSED!`)
