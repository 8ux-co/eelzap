import { isPreviewResult } from './utils'

/**
 * Pluggable storage interface for last-known-good caching.
 *
 * Implement this to persist content to any backend (KV, Redis,
 * filesystem, IndexedDB, etc.). The SDK ships a built-in
 * {@link MemoryCacheAdapter} for processes that stay alive.
 */
export interface CacheAdapter<T = unknown> {
  get(key: string): Promise<T | undefined> | T | undefined
  set(key: string, value: T): Promise<void> | void
}

export type CacheStrategy = 'network-first' | 'cache-first'

export interface CachedFetchOptions<T = unknown> {
  key: string
  fetcher: () => Promise<T>
  adapter: CacheAdapter<T>
  strategy?: CacheStrategy
}

/**
 * Simple in-memory adapter. Suitable for long-lived server processes
 * or development. Data is lost when the process restarts.
 */
export class MemoryCacheAdapter implements CacheAdapter {
  readonly #store = new Map<string, unknown>()

  get(key: string): unknown {
    return this.#store.get(key)
  }

  set(key: string, value: unknown): void {
    this.#store.set(key, value)
  }

  /** Returns the number of cached entries. */
  get size(): number {
    return this.#store.size
  }

  /** Removes a specific key from the cache. */
  delete(key: string): boolean {
    return this.#store.delete(key)
  }

  /** Removes all cached entries. */
  clear(): void {
    this.#store.clear()
  }
}

/**
 * Caches content fetched from the CMS, with one of two strategies:
 *
 * - `network-first` (the default, and the only one the positional form
 *   uses): runs `fetcher`, caches the result on success, and falls back to
 *   the last cached value on failure.
 * - `cache-first` (options form): returns the cached value when there is
 *   one, and fetches and caches only on a miss.
 *
 * If no cached value exists and the fetch fails, the original error is
 * re-thrown — there are no hardcoded fallbacks.
 *
 * A preview response (a read with `preview: true`, or any read with a `zpt_`
 * preview token) is returned but NEVER stored, under either strategy
 * (zap-cms-v2 §7.5): it carries drafts and stega markers, and a cache entry
 * would hand them to the next visitor.
 *
 * @param key     - Stable cache key (e.g. `"homepage"`, `"blog-posts:page-1"`).
 * @param fetcher - An async function that fetches fresh content from the CMS.
 * @param adapter - Storage backend that persists last-known-good values.
 * @returns The fresh result or the last successfully cached value.
 *
 * @example
 * ```ts
 * const cache = new MemoryCacheAdapter();
 *
 * const homepage = await cachedFetch(
 *   'homepage',
 *   () => cms.documents.get('homepage'),
 *   cache,
 * );
 * ```
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  adapter: CacheAdapter<T>,
): Promise<T>
export async function cachedFetch<T>(options: CachedFetchOptions<T>): Promise<T>
export async function cachedFetch<T>(
  keyOrOptions: string | CachedFetchOptions<T>,
  fetcher?: () => Promise<T>,
  adapter?: CacheAdapter<T>,
): Promise<T> {
  const options =
    typeof keyOrOptions === 'string'
      ? {
          key: keyOrOptions,
          fetcher: fetcher as () => Promise<T>,
          adapter: adapter as CacheAdapter<T>,
          strategy: 'network-first' as CacheStrategy,
        }
      : {
          ...keyOrOptions,
          strategy: keyOrOptions.strategy ?? 'network-first',
        }

  if (options.strategy === 'cache-first') {
    const cached = await options.adapter.get(options.key)
    if (cached !== undefined) {
      return cached
    }

    return store(options.adapter, options.key, await options.fetcher())
  }

  try {
    return await store(options.adapter, options.key, await options.fetcher())
  } catch (error) {
    const cached = await options.adapter.get(options.key)
    if (cached !== undefined) {
      return cached
    }
    throw error
  }
}

async function store<T>(adapter: CacheAdapter<T>, key: string, result: T): Promise<T> {
  if (!isPreviewResult(result)) await adapter.set(key, result)
  return result
}
