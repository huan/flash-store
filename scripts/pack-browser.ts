/**
 * Verifies the published browser exports in Chromium using an installed npm
 * tarball and a real IndexedDB origin. It exercises bundled exports and native
 * ESM requests without Node globals or shims.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

/** Checks both browser exports and reopens bundled data from unbundled ESM after a reload. */
export async function smokeBrowser(directory: string): Promise<void> {
  const result = await build({
    absWorkingDir: directory,
    stdin: {
      contents: `
        export { default, FlashStore, FlashStoreSync, VERSION } from 'flash-store'
        export { FlashStore as ExplicitBrowserStore } from 'flash-store/browser'
      `,
      resolveDir: directory,
    },
    platform: 'browser',
    bundle: true,
    format: 'esm',
    write: false,
  })
  const bundle = result.outputFiles[0]
  assert.ok(bundle)
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const origin = 'https://flash-store.test/'
    const bundleUrl = new URL('store.js', origin).href
    const html = `<!doctype html><title>Flash Store smoke test</title>
      <script type="importmap">
        {
          "imports": {
            "flash-store/browser": "/node_modules/flash-store/dist/src/browser.js",
            "brolog": "/node_modules/brolog/dist/esm/src/mod.js",
            "ordered-binary": "/node_modules/ordered-binary/index.js"
          }
        }
      </script>`
    await context.route(`${origin}**`, (route) => {
      const url = route.request().url()
      if (url === bundleUrl)
        return route.fulfill({
          contentType: 'text/javascript',
          body: bundle.text,
        })
      if (url === origin)
        return route.fulfill({ contentType: 'text/html', body: html })
      const { pathname } = new URL(url)
      if (
        !/^\/node_modules\/(?:flash-store\/dist\/|brolog\/dist\/esm\/|ordered-binary\/index\.js$)/.test(
          pathname,
        )
      )
        return route.abort()
      return route.fulfill({
        path: join(directory, pathname),
        contentType: pathname.endsWith('.json')
          ? 'application/json'
          : 'text/javascript',
      })
    })
    const page = await context.newPage()
    await page.goto(origin)
    const name = 'packed-flash-store'
    const version = await page.evaluate(
      async ({ bundleUrl, name }) => {
        const api: typeof import('../src/browser.ts') & {
          ExplicitBrowserStore: typeof import('../src/browser.ts').FlashStore
        } = await import(bundleUrl)
        if (
          api.default !== api.FlashStore ||
          api.FlashStore !== api.ExplicitBrowserStore
        )
          throw new Error(
            'Browser exports resolve to different implementations',
          )
        if ('Buffer' in globalThis || 'process' in globalThis)
          throw new Error('Browser smoke requires no Node globals')
        const store = new api.FlashStore(name)
        await store.set('key', { value: 42 })
        await store.close()
        return api.VERSION
      },
      { bundleUrl, name },
    )
    assert.match(version, /^2\./)
    await page.reload()
    const read = await page.evaluate(async (name) => {
      const specifier = 'flash-store/browser'
      const api: typeof import('../src/browser.ts') = await import(specifier)
      if (api.default !== api.FlashStore || !/^2\./.test(api.VERSION))
        throw new Error('Unbundled ESM exports or package metadata are invalid')
      const reopened = new api.FlashStoreSync(name)
      await reopened.ready()
      const value = reopened.get('key')
      await reopened.close()
      return value
    }, name)
    assert.deepEqual(read, { value: 42 })

    const peer = await context.newPage()
    await peer.goto(origin)
    await peer.evaluate(
      async ({ bundleUrl, name }) => {
        const api: typeof import('../src/browser.ts') = await import(bundleUrl)
        const store = new api.FlashStore(name)
        // Keep the connection alive in this page while the other page deletes it.
        if (!(await store.has('key')))
          throw new Error('Peer could not read persisted data')
        Object.assign(globalThis, { peerStore: store })
      },
      { bundleUrl, name },
    )
    const destroyed = await page.evaluate(
      async ({ bundleUrl, name }) => {
        const api: typeof import('../src/browser.ts') = await import(bundleUrl)
        const store = new api.FlashStore(name)
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) {
          const request = put.apply(this, args)
          // Abort after the put request succeeds, before the transaction commits.
          request.addEventListener('success', () => this.transaction.abort(), {
            once: true,
          })
          return request
        }
        try {
          await store.set('aborted', 1).then(
            () => {
              throw new Error('Aborted write reported success')
            },
            (error: unknown) => {
              if (!(error instanceof Error) || !/abort/i.test(error.message))
                throw error
            },
          )
        } finally {
          IDBObjectStore.prototype.put = put
        }
        if (await store.has('aborted'))
          throw new Error('Aborted write persisted')
        await store.destroy()
        const fresh = new api.FlashStore(name)
        const size = await fresh.size
        await fresh.set('replacement', 99)
        await fresh.close()
        return size === 0
      },
      { bundleUrl, name },
    )
    assert.equal(destroyed, true)

    const stalePeer = await peer.evaluate(async () => {
      const store: import('../src/browser.ts').FlashStore | undefined =
        Reflect.get(globalThis, 'peerStore')
      if (!store) throw new Error('Missing peer store')
      const closed = await store.get('key').then(
        () => false,
        (error: unknown) =>
          error instanceof Error && /closed/.test(error.message),
      )
      const deletionRejected = await store.destroy().then(
        () => false,
        (error: unknown) =>
          error instanceof Error &&
          /external database deletion/.test(error.message),
      )
      return { closed, deletionRejected }
    })
    assert.deepEqual(stalePeer, { closed: true, deletionRejected: true })
    const replacementValue = await page.evaluate(
      async ({ bundleUrl, name }) => {
        const api: typeof import('../src/browser.ts') = await import(bundleUrl)
        const replacement = new api.FlashStore(name)
        const value = await replacement.get('replacement')
        await replacement.destroy()
        return value
      },
      { bundleUrl, name },
    )
    assert.equal(replacementValue, 99)
  } finally {
    await browser.close()
  }
}
