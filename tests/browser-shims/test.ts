/**
 * Adapts the node:test primitives used by the shared suite to Web Test Runner's
 * Mocha globals. Cleanup is local to each test and runs even after an assertion fails.
 */
type Hook = () => unknown
type Test = (context: { after(hook: Hook): void }) => unknown

declare const it: (name: string, run: () => Promise<void>) => void

/** Registers a test with a node:test-style cleanup context. */
export function test(name: string, run: Test): void {
  it(name, async () => {
    const hooks: Hook[] = []
    try {
      await run({ after: (hook) => hooks.push(hook) })
    } finally {
      for (const hook of hooks) await hook()
    }
  })
}
