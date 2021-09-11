#!/usr/bin/env -S node --no-warnings --loader ts-node/esm
import { test }  from 'tstest'

test('smoke testing', async t => {
  await t.skip('to be written')
})
