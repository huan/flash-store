import {
  FlashStore,
}             from '../src/mod.js'

async function main(): Promise<number> {
  const flashStore = new FlashStore('flashstore.workdir')
  await flashStore.set(1, 'a')
  await flashStore.set(2, 'b')
  await flashStore.set(3, 'c')
  console.log(`key: 1, value: ${await flashStore.get(1)}`)
  console.log(`key: 2, value: ${await flashStore.get(2)}`)
  console.log(`key: 3, value: ${await flashStore.get(3)}`)

  console.log(`FlashStore data count: ${await flashStore.size}`)

  console.log('Show all values')
  for await (const value of flashStore.values()) {
    console.log(value)
  }

  console.log('Show all keys')
  for await (const key of flashStore.keys()) {
    console.log(key)
  }

  console.log('Show all keys grater than 3')
  for await (const key of flashStore.keys({gte: 3})) {
    console.log(key)
  }

  console.log('Reverse key result')
  for await (const key of flashStore.keys({reverse: true})) {
    console.log(key)
  }

  console.log('Limit result to 1')
  for await (const key of flashStore.keys({limit: 1})) {
    console.log(key)
  }

  flashStore.destroy()
  return 0
}

main()
.then(process.exit)
.catch(e => {
  console.error(e)
  process.exit(-1)
})

// flashStore.set('a', 3)
