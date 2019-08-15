import {
  FlashStore,
  FlashStoreSync,
  VERSION,
}                   from 'flash-store'

if (VERSION === '0.0.0') {
  throw new Error('version should be set befoer publishing')
}

const store = new FlashStore()
store.destroy()

const storeSync = new FlashStoreSync()
storeSync.destroy()

console.info(`Smoke Testing v${store.version()} PASSED!`)
