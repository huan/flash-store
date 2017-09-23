const { FlashStore } = require('flash-store')

const store = new FlashStore()
store.destroy()

console.log('Smoke Testing PASSED!')
