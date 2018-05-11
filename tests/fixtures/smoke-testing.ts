import { FlashStore } from 'flash-store'

const store = new FlashStore()
store.destroy()

console.log(`Smoke Testing v${store.version()} PASSED!`)
