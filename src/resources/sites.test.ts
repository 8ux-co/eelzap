import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { createClient } from '../client'
import type { SiteListEntry } from '../types/common'
import { SitesResource } from './sites'

const SITE = {
  id: 'site_1',
  key: 'verdeorigen',
  name: 'Verde Origen',
  url: 'https://verdeorigen.co',
  defaultLocale: 'es',
  locales: ['es', 'en'],
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z',
}

describe('SitesResource', () => {
  it('lists the workspace’s sites from `{ sites }`', async () => {
    const fetch = vi.fn(async () => Response.json({ sites: [SITE] }))
    const sdk = createClient({ apiKey: 'eel_sk_test', baseUrl: 'https://zap.test', fetch })

    const sites = await sdk.sites.list()

    expectTypeOf(sites).toEqualTypeOf<SiteListEntry[]>()
    expect(sites).toEqual([SITE])
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(new URL(url).pathname).toBe('/v1/sites')
    expect(new URL(url).search).toBe('')
    expect(sdk.sites).toBeInstanceOf(SitesResource)
  })
})
