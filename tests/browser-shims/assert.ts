/**
 * Maps the strict Node assertions used by the shared unit suite to Chai.
 * This test-only module is never loaded by package consumers.
 */
import { assert } from 'chai'

type ExpectedError = RegExp | ((error: unknown) => boolean)

/** Tests a message or delegates to a predicate as node:assert/strict does. */
function assertError(error: unknown, expected: ExpectedError): void {
  if (typeof expected === 'function') assert.isTrue(expected(error))
  else
    assert.match(
      error instanceof Error ? error.message : String(error),
      expected,
    )
}

export default {
  equal: assert.strictEqual,
  deepEqual: assert.deepEqual,
  match: assert.match,
  ok: assert.ok,
  /** Asserts a promise rejects and matches its rejection. */
  async rejects(
    action: Promise<unknown> | (() => Promise<unknown>),
    expected: ExpectedError,
  ): Promise<void> {
    try {
      await (typeof action === 'function' ? action() : action)
    } catch (error) {
      assertError(error, expected)
      return
    }
    assert.fail('Expected a rejection')
  },
  /** Asserts a synchronous throw and matches the thrown error. */
  throws(action: () => unknown, expected: ExpectedError): void {
    try {
      action()
    } catch (error) {
      assertError(error, expected)
      return
    }
    assert.fail('Expected a synchronous throw')
  },
}
