import { describe, expect, it, vi } from 'vitest'

import { cachedFetch, MemoryCacheAdapter } from './cache'
import { createClient } from './client'
import type { ClientConfig } from './client'

/**
 * Draft preview (Zap CMS v2 §2.7): `preview: true` sends `preview=1` on the
 * item and document reads, and a preview token (`zpt_…`) is accepted as the
 * credential. Asserted on the request that actually leaves through `fetch`.
 */

const PREVIEW_TOKEN = `zpt_${'A'.repeat(43)}`

function client(config: Partial<ClientConfig> = {}) {
  const fetch = vi.fn(async () => Response.json({ data: [] }))
  const sdk = createClient({
    apiKey: 'secret_12345678',
    baseUrl: 'https://api.example.com',
    fetch,
    ...config,
  })
  const sent = () =>
    fetch.mock.calls.map((call) => {
      const [url, init] = call as unknown as [string, RequestInit]
      return {
        url: new URL(url),
        authorization: new Headers(init.headers).get('Authorization'),
      }
    })
  return { sdk, sent }
}

/** The four reads, each called with per-request options. */
const reads = (
  sdk: ReturnType<typeof createClient>,
  options: { preview?: boolean; stega?: boolean } = {},
): Array<Promise<unknown>> => [
  sdk.items.list('blog', options),
  sdk.items.get('blog', 'hello', options),
  sdk.documents.list(options),
  sdk.documents.get('home', options),
]

describe('preview', () => {
  it('sends preview=1 on the four reads when asked per request', async () => {
    const { sdk, sent } = client()
    await Promise.all(reads(sdk, { preview: true }))
    expect(sent().map(({ url }) => url.searchParams.get('preview'))).toEqual(['1', '1', '1', '1'])
  })

  it('sends no preview param at all otherwise — the request is what it always was', async () => {
    const { sdk, sent } = client()
    await Promise.all([...reads(sdk), ...reads(sdk, { preview: false })])
    for (const { url } of sent()) expect(url.searchParams.has('preview')).toBe(false)
  })

  it('takes a client-wide default, and a request can turn it off', async () => {
    const { sdk, sent } = client({ preview: true })
    await sdk.items.list('blog')
    await sdk.items.collection('blog').get()
    await sdk.documents.get('home', { preview: false })
    expect(sent().map(({ url }) => url.searchParams.get('preview'))).toEqual(['1', '1', null])
  })

  it('never puts preview on reads that do not serve it', async () => {
    const { sdk, sent } = client({ preview: true })
    await sdk.collections.list()
    expect(sent()[0]!.url.searchParams.has('preview')).toBe(false)
  })
})

describe('a preview token as the credential', () => {
  it('is sent as the bearer, and turns preview on by default', async () => {
    const { sdk, sent } = client({ apiKey: PREVIEW_TOKEN })
    await Promise.all(reads(sdk))
    for (const { url, authorization } of sent()) {
      expect(authorization).toBe(`Bearer ${PREVIEW_TOKEN}`)
      expect(url.searchParams.get('preview')).toBe('1')
    }
  })

  it('keeps an explicit preview: false', async () => {
    const { sdk, sent } = client({ apiKey: PREVIEW_TOKEN, preview: false })
    await sdk.items.list('blog')
    expect(sent()[0]!.url.searchParams.has('preview')).toBe(false)
  })

  it('is masked in string output like any key', () => {
    const { sdk } = client({ apiKey: PREVIEW_TOKEN })
    expect(sdk.toString()).not.toContain(PREVIEW_TOKEN)
  })
})

describe('stega', () => {
  it('sends stega=0 beside preview=1 on the four reads when stega is false', async () => {
    const { sdk, sent } = client()
    await Promise.all(reads(sdk, { preview: true, stega: false }))
    for (const { url } of sent()) {
      expect(url.searchParams.get('preview')).toBe('1')
      expect(url.searchParams.get('stega')).toBe('0')
    }
  })

  it('sends no stega param when it is true or unset: markers are the preview default', async () => {
    const { sdk, sent } = client()
    await Promise.all([
      ...reads(sdk, { preview: true }),
      ...reads(sdk, { preview: true, stega: true }),
    ])
    for (const { url } of sent()) expect(url.searchParams.has('stega')).toBe(false)
  })

  it('sends nothing without preview: a published read never carries markers', async () => {
    const { sdk, sent } = client()
    await Promise.all([
      ...reads(sdk, { stega: false }),
      ...reads(sdk, { preview: false, stega: false }),
    ])
    for (const { url } of sent()) {
      expect(url.searchParams.has('stega')).toBe(false)
      expect(url.searchParams.has('preview')).toBe(false)
    }
  })

  it('works with a preview token, whose reads are preview by default', async () => {
    const { sdk, sent } = client({ apiKey: PREVIEW_TOKEN })
    await sdk.documents.get('home', { stega: false })
    expect(sent()[0]!.url.searchParams.get('stega')).toBe('0')
  })
})

describe('cachedFetch never stores a preview response (§7.5)', () => {
  for (const strategy of ['network-first', 'cache-first'] as const) {
    it(`${strategy}: returns a preview read but leaves the cache empty`, async () => {
      const { sdk } = client()
      const adapter = new MemoryCacheAdapter()
      const result = await cachedFetch({
        key: 'home',
        fetcher: () => sdk.documents.get('home', { preview: true }),
        adapter,
        strategy,
      })
      expect(result).toEqual({ data: [] })
      expect(adapter.size).toBe(0)
    })

    it(`${strategy}: leaves out every read made with a preview token`, async () => {
      const { sdk } = client({ apiKey: PREVIEW_TOKEN, preview: false })
      const adapter = new MemoryCacheAdapter()
      await cachedFetch({ key: 'blog', fetcher: () => sdk.items.list('blog'), adapter, strategy })
      expect(adapter.size).toBe(0)
    })

    it(`${strategy}: still stores a published read`, async () => {
      const { sdk } = client()
      const adapter = new MemoryCacheAdapter()
      await cachedFetch({
        key: 'home',
        fetcher: () => sdk.documents.get('home'),
        adapter,
        strategy,
      })
      expect(adapter.size).toBe(1)
      expect(adapter.get('home')).toEqual({ data: [] })
    })
  }

  it('the positional form skips a preview read too', async () => {
    const { sdk } = client()
    const adapter = new MemoryCacheAdapter()
    await cachedFetch('blog', () => sdk.items.list('blog', { preview: true }), adapter)
    expect(adapter.size).toBe(0)
  })

  it('keeps the preview mark out of JSON and spreads', async () => {
    const { sdk } = client()
    const result = await sdk.items.list('blog', { preview: true })
    expect(JSON.stringify(result)).toBe('{"data":[]}')
    expect(Object.keys({ ...result })).toEqual(['data'])
  })
})
