/**
 * Binds the public native FlashStore constructor to LMDB. Filesystem paths,
 * destruction safeguards, and Node diagnostics stay behind this entry point.
 */
import { channel } from 'node:diagnostics_channel'
import { rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { parse, resolve } from 'node:path'
import { IF_EXISTS, open, type RootDatabase } from 'lmdb'
import { FlashStoreCore, type StoreKey } from '../universal/flash-store-core.ts'
import { encodePrefixEnd } from '../universal/key-encoding.ts'
import type {
  ScanRange,
  StoreBackend,
  StoredEntry,
} from '../universal/store-backend.ts'

export type {
  IteratorOptions,
  StoreKey,
} from '../universal/flash-store-core.ts'

const operations = channel('flash-store.operation')

/** Adapts the existing LMDB layout without changing its key encoding or JSON bytes. */
class LmdbBackend implements StoreBackend {
  private readonly db: RootDatabase<string, StoreKey>
  private readonly path: string

  /** Opens the existing on-disk database or creates a fresh environment. */
  constructor(path: string) {
    this.path = path
    this.db = open({ path, noSubdir: false, encoding: 'string' })
  }

  /** Enqueues a write of serialized JSON. */
  put(key: StoreKey, json: string): Promise<unknown> {
    return this.db.put(key, json)
  }

  /** Reads from the current transaction snapshot. */
  get(key: StoreKey): string | undefined {
    return this.db.get(key)
  }

  /** Checks existence without decoding the value. */
  has(key: StoreKey): boolean {
    return this.db.doesExist(key)
  }

  /** Reports existence in the transaction that performs the deletion. */
  delete(key: StoreKey): Promise<boolean> {
    // A plain remove() reports success even when the key was absent.
    return this.db.remove(key, IF_EXISTS)
  }

  /** Queues an atomic clear. */
  clear(): Promise<void> {
    return this.db.clearAsync()
  }

  /** Counts the entries in the current snapshot. */
  async count(): Promise<number> {
    return this.db.getCount()
  }

  /** Seeks directly to the range and releases the LMDB cursor on early exit. */
  *scan({
    lower,
    upper,
    lowerOpen,
    upperOpen,
    reverse,
    prefix,
    limit,
  }: ScanRange): Iterable<StoredEntry> {
    const endOfPrefix =
      reverse && prefix !== undefined ? encodePrefixEnd(prefix) : undefined
    const range =
      prefix === undefined
        ? {
            start: reverse ? upper : lower,
            end: reverse ? lower : upper,
            reverse,
            exclusiveStart: reverse ? upperOpen : lowerOpen,
            inclusiveEnd: reverse ? !lowerOpen : !upperOpen,
          }
        : {
            start: reverse ? endOfPrefix : prefix,
            reverse,
            exclusiveStart: reverse && endOfPrefix !== undefined,
          }
    let count = 0
    for (const entry of this.db.getRange(range)) {
      if (
        prefix !== undefined &&
        (typeof entry.key !== 'string' || !entry.key.startsWith(prefix))
      )
        break
      yield entry
      if (++count === limit) break
    }
  }

  /** Flushes pending writes and closes LMDB. */
  close(): Promise<void> {
    return this.db.close()
  }

  /** Removes the dedicated directory after the facade closes the environment. */
  destroy(): Promise<void> {
    return rm(this.path, { recursive: true, force: true })
  }

  /** Publishes the operation name after a successful commit without storing caller data. */
  publish(operation: 'set' | 'delete' | 'clear'): void {
    if (operations.hasSubscribers) operations.publish({ operation })
  }
}

/** Persistent Map backed by LMDB with JSON-serialized values. */
export class FlashStore<
  K extends StoreKey = StoreKey,
  V = unknown,
> extends FlashStoreCore<K, V> {
  /** Opens an LMDB database in the specified directory. */
  constructor(workdir: string) {
    const path = resolve(workdir)
    super(path, new LmdbBackend(path), workdir)
  }

  /** Refuses to close or remove protected locations. Use a dedicated directory. */
  override async destroy(): Promise<void> {
    const protectedPaths = [
      parse(this.workdir).root,
      resolve(process.cwd()),
      resolve(tmpdir()),
      resolve(homedir()),
    ]
    if (protectedPaths.includes(this.workdir))
      throw new Error('Refusing to remove a protected directory')
    await super.destroy()
  }
}

export default FlashStore
