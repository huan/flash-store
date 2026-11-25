/**
 * Runs the same source unit tests as Node and Deno inside Playwright Chromium.
 * Test imports use browser shims. Production imports resolve as browser ESM.
 */
import { esbuildPlugin } from '@web/dev-server-esbuild'
import { playwrightLauncher } from '@web/test-runner-playwright'

export default {
  files: 'src/**/*.test.ts',
  nodeResolve: { exportConditions: ['browser'] },
  coverageConfig: {
    include: ['src/**/*.ts'],
    exclude: [
      'src/**/*.test.ts',
      'src/test-fixture.ts',
      'src/flash-store.ts',
      'src/flash-store-sync.ts',
    ],
    reportDir: 'coverage/browser',
    reporters: ['lcov', 'html'],
  },
  plugins: [
    {
      name: 'flash-store-browser-tests',
      resolveImport({ source }) {
        switch (source) {
          case 'node:test':
            return '/tests/browser-shims/test.ts'
          case 'node:assert/strict':
            return '/tests/browser-shims/assert.ts'
        }
      },
    },
    esbuildPlugin({ target: 'esnext', ts: true }),
  ],
  browsers: [playwrightLauncher({ product: 'chromium' })],
}
