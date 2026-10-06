import { describe, expect, it, vi } from 'vitest'

import { MemoryCacheAdapter, cachedFetch } from './cache'
import type { CacheAdapter } from './cache'
import { markPreview } from './utils'

describe('MemoryCacheAdapter', () => {
  it('returns undefined for unknown keys', () => {
    const adapter = new MemoryCacheAdapter()
    expect(adapter.get('missing')).toBeUndefined()
  })

  it('round-trips a value', () => {
    const adapter = new MemoryCacheAdapter()
    adapter.set('k', { title: 'Hello' })
    expect(adapter.get('k')).toEqual({ title: 'Hello' })
  })

  it('reports size', () => {
    const adapter = new MemoryCacheAdapter()
    expect(adapter.size).toBe(0)
    adapter.set('a', 1)
    adapter.set('b', 2)
    expect(adapter.size).toBe(2)
  })

  it('deletes a key', () => {
    const adapter = new MemoryCacheAdapter()
    adapter.set('a', 1)
    expect(adapter.delete('a')).toBe(true)
    expect(adapter.get('a')).toBeUndefined()
  })

  it('clears all entries', () => {
    const adapter = new MemoryCacheAdapter()
    adapter.set('a', 1)
    adapter.set('b', 2)
    adapter.clear()
    expect(adapter.size).toBe(0)
  })
})

describe('cachedFetch', () => {
  it('returns fresh data and caches it', async () => {
    const adapter = new MemoryCacheAdapter()
    const fetcher = vi.fn().mockResolvedValue({ title: 'Fresh' })

    const result = await cachedFetch('doc', fetcher, adapter)

    expect(result).toEqual({ title: 'Fresh' })
    expect(adapter.get('doc')).toEqual({ title: 'Fresh' })
  })

  it('returns cached data when fetcher fails', async () => {
    const adapter = new MemoryCacheAdapter()
    adapter.set('doc', { title: 'Cached' })

    const fetcher = vi.fn().mockRejectedValue(new Error('Network down'))

    const result = await cachedFetch('doc', fetcher, adapter)

    expect(result).toEqual({ title: 'Cached' })
  })

  it('throws when fetcher fails and cache is empty', async () => {
    const adapter = new MemoryCacheAdapter()
    const fetcher = vi.fn().mockRejectedValue(new Error('Network down'))

    await expect(cachedFetch('doc', fetcher, adapter)).rejects.toThrow('Network down')
  })

  it('updates the cache on every successful fetch', async () => {
    const adapter = new MemoryCacheAdapter()

    await cachedFetch('doc', () => Promise.resolve({ v: 1 }), adapter)
    await cachedFetch('doc', () => Promise.resolve({ v: 2 }), adapter)

    expect(adapter.get('doc')).toEqual({ v: 2 })
  })

  it('works with async cache adapters', async () => {
    const store = new Map<string, unknown>()
    const asyncAdapter: CacheAdapter<string> = {
      get: (key: string) => Promise.resolve(store.get(key) as string | undefined),
      set: (key: string, value: string) => {
        store.set(key, value)
        return Promise.resolve()
      },
    }

    await cachedFetch('key', () => Promise.resolve('value'), asyncAdapter)
    const result = await cachedFetch('key', () => Promise.reject(new Error('fail')), asyncAdapter)

    expect(result).toBe('value')
  })

  it('supports cache-first strategy with the options overload', async () => {
    const adapter = new MemoryCacheAdapter()
    adapter.set('doc', { title: 'Cached first' })
    const fetcher = vi.fn().mockResolvedValue({ title: 'Fresh' })

    const result = await cachedFetch({
      key: 'doc',
      fetcher,
      adapter,
      strategy: 'cache-first',
    })

    expect(result).toEqual({ title: 'Cached first' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('defaults the options overload to network-first', async () => {
    const adapter = new MemoryCacheAdapter()
    adapter.set('doc', { title: 'Cached first' })
    const fetcher = vi.fn().mockResolvedValue({ title: 'Fresh again' })

    const result = await cachedFetch({
      key: 'doc',
      fetcher,
      adapter,
    })

    expect(result).toEqual({ title: 'Fresh again' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(adapter.get('doc')).toEqual({ title: 'Fresh again' })
  })

  it('fetches and caches on cache-first misses', async () => {
    const adapter = new MemoryCacheAdapter()
    const fetcher = vi.fn().mockResolvedValue({ title: 'Fresh' })

    const result = await cachedFetch({
      key: 'doc',
      fetcher,
      adapter,
      strategy: 'cache-first',
    })

    expect(result).toEqual({ title: 'Fresh' })
    expect(adapter.get('doc')).toEqual({ title: 'Fresh' })
  })

  it('rethrows cache-first failures when no cached value exists', async () => {
    const adapter = new MemoryCacheAdapter()
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(
      cachedFetch({
        key: 'doc',
        fetcher,
        adapter,
        strategy: 'cache-first',
      }),
    ).rejects.toThrow('offline')
  })
})

describe('cachedFetch and preview results', () => {
  it('returns a marked preview result without storing it, under both strategies', async () => {
    for (const strategy of ['network-first', 'cache-first'] as const) {
      const adapter = { get: vi.fn(() => undefined), set: vi.fn() }
      const value = markPreview({ title: 'Draft' })
      await expect(
        cachedFetch({ key: 'home', fetcher: async () => value, adapter, strategy }),
      ).resolves.toBe(value)
      expect(adapter.set).not.toHaveBeenCalled()
    }
  })

  it('stores an unmarked result as before', async () => {
    const adapter = { get: vi.fn(() => undefined), set: vi.fn() }
    await cachedFetch('home', async () => ({ title: 'Live' }), adapter)
    expect(adapter.set).toHaveBeenCalledWith('home', { title: 'Live' })
  })
})
