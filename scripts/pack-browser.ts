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
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';">
      <script type="importmap">
        {
          "imports": {
            "flash-store/browser": "/node_modules/flash-store/dist/src/universal/mod.js",
            "brolog": "/node_modules/brolog/dist/esm/src/mod.js"
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
        !/^\/node_modules\/(?:flash-store\/dist\/|brolog\/dist\/esm\/)/.test(
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
        const api: typeof import('../src/universal/mod.ts') & {
          ExplicitBrowserStore: typeof import('../src/universal/mod.ts').FlashStore
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
      const api: typeof import('../src/universal/mod.ts') = await import(
        specifier
      )
      if (api.default !== api.FlashStore || !/^2\./.test(api.VERSION))
        throw new Error('Unbundled ESM exports or package metadata are invalid')
      const reopened = new api.FlashStoreSync(name)
      await reopened.ready()
      const value = reopened.get('key')
      await reopened.close()
      return value
    }, name)
    assert.deepEqual(read, { value: 42 })

    const nativeKeyInspection = await page.evaluate(async (name) => {
      const api: typeof import('../src/universal/mod.ts') = await import(
        'flash-store/browser'
      )
      const store = new api.FlashStore(name)
      await store.set('string-key', 'val-str')
      await store.set(123, 'val-num')
      await store.set('\u{10000}', 'supplementary')
      await store.set('\uE000', 'bmp')

      const rawDb: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(`flash-store:${name}`)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        const tx = rawDb.transaction('records', 'readonly')
        const objStore = tx.objectStore('records')
        const rawKeys: unknown[] = await new Promise((resolve, reject) => {
          const req = objStore.getAllKeys()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
        const keyTypes = rawKeys.map((k) => typeof k)
        const isNotBinary = rawKeys.every(
          (k) => !(k instanceof ArrayBuffer) && !ArrayBuffer.isView(k),
        )
        const unicodeKeys = rawKeys.filter(
          (k) => k === '\u{10000}' || k === '\uE000',
        )
        return { keyTypes, isNotBinary, unicodeKeys }
      } finally {
        rawDb.close()
        await store.close()
      }
    }, name)
    assert.deepEqual(nativeKeyInspection.keyTypes, [
      'number',
      'string',
      'string',
      'string',
      'string',
    ])
    assert.equal(nativeKeyInspection.isNotBinary, true)
    assert.deepEqual(nativeKeyInspection.unicodeKeys, ['\u{10000}', '\uE000'])

    const failedOpenDestroyed = await page.evaluate(async () => {
      const api: typeof import('../src/universal/mod.ts') = await import(
        'flash-store/browser'
      )
      const name = 'failed-open-cleanup'
      const existing: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(`flash-store:${name}`, 2)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      existing.close()

      const store = new api.FlashStore(name)
      await store.get('any').then(
        () => {
          throw new Error('Expected open to fail on version mismatch')
        },
        () => {},
      )

      await store.destroy()

      const fresh: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(`flash-store:${name}`, 1)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const version = fresh.version
      fresh.close()
      await new api.FlashStore(name).destroy()
      return version === 1
    })
    assert.equal(failedOpenDestroyed, true)

    const peer = await context.newPage()
    await peer.goto(origin)
    await peer.evaluate(
      async ({ bundleUrl, name }) => {
        const api: typeof import('../src/universal/mod.ts') = await import(
          bundleUrl
        )
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
        const api: typeof import('../src/universal/mod.ts') = await import(
          bundleUrl
        )
        const store = new api.FlashStore(name)
        const put = IDBObjectStore.prototype.put
        let windowErrorFired = false
        const onError = () => {
          windowErrorFired = true
        }
        window.addEventListener('error', onError)
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
          window.removeEventListener('error', onError)
        }
        if (windowErrorFired)
          throw new Error('Aborted transaction error bubbled to window')
        if (await store.has('aborted'))
          throw new Error('Aborted write persisted')

        const putOriginal = IDBObjectStore.prototype.put
        let quotaWindowErrorFired = false
        const onQuotaWindowError = () => {
          quotaWindowErrorFired = true
        }
        window.addEventListener('error', onQuotaWindowError)
        IDBObjectStore.prototype.put = function (...args) {
          const request = putOriginal.apply(this, args)
          setTimeout(() => {
            Object.defineProperty(request, 'error', {
              value: new DOMException(
                'The quota has been exceeded.',
                'QuotaExceededError',
              ),
              configurable: true,
            })
            request.dispatchEvent(
              new Event('error', { bubbles: true, cancelable: true }),
            )
          }, 0)
          return request
        }
        try {
          await store.set('quota-fail', 1).then(
            () => {
              throw new Error('Failed request reported success')
            },
            (error: unknown) => {
              if (!(error instanceof Error) || !/quota/i.test(error.message))
                throw error
            },
          )
        } finally {
          IDBObjectStore.prototype.put = putOriginal
          window.removeEventListener('error', onQuotaWindowError)
        }
        if (quotaWindowErrorFired)
          throw new Error('Failed request error bubbled to window')
        if (await store.has('quota-fail'))
          throw new Error('Failed request write persisted')

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
      const store: import('../src/universal/mod.ts').FlashStore | undefined =
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
          /external database version change/.test(error.message),
      )
      return { closed, deletionRejected }
    })
    assert.deepEqual(stalePeer, { closed: true, deletionRejected: true })
    const replacementValue = await page.evaluate(
      async ({ bundleUrl, name }) => {
        const api: typeof import('../src/universal/mod.ts') = await import(
          bundleUrl
        )
        const replacement = new api.FlashStore(name)
        const value = await replacement.get('replacement')
        await replacement.destroy()
        return value
      },
      { bundleUrl, name },
    )
    assert.equal(replacementValue, 99)

    const upgradedValue = await page.evaluate(async (bundleUrl) => {
      const api: typeof import('../src/universal/mod.ts') = await import(
        bundleUrl
      )
      const name = 'schema-upgrade'
      const previous = new api.FlashStore(name)
      await previous.set('keep', 42)
      /** Opens the upgraded schema without giving the old handle access to it. */
      function openUpgraded(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(`flash-store:${name}`, 2)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      }
      const upgraded = await openUpgraded()
      upgraded.close()
      await previous.destroy().then(
        () => {
          throw new Error('Old handle deleted the upgraded database')
        },
        (error: unknown) => {
          if (
            !(error instanceof Error) ||
            !/external database version change/.test(error.message)
          )
            throw error
        },
      )
      const database = await openUpgraded()
      try {
        return await new Promise<unknown>((resolve, reject) => {
          const transaction = database.transaction('records')
          const request = transaction.objectStore('records').getAll()
          transaction.oncomplete = () => resolve(request.result[0])
          transaction.onabort = () => reject(transaction.error)
        })
      } finally {
        database.close()
      }
    }, bundleUrl)
    assert.equal(upgradedValue, '42')
  } finally {
    await browser.close()
  }
}
