import os from 'os'

import {
  VERSION,
  FlashStore,
  FlashStoreSync,
}                   from 'flash-store'

async function main () {
  const store = new FlashStore(os.tmpdir())
  await store.destroy()

  const storeSync = new FlashStoreSync(os.tmpdir())
  await storeSync.destroy()

  if (VERSION === '0.0.0') {
    throw new Error('version should be set before publishing')
  }

  console.log(`Smoke Testing v${store.version()} PASSED!`)
}

main()
  .catch(console.error)
