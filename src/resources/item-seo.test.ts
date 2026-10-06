import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '../http'
import { ItemSeoResource } from './item-seo'

describe('ItemSeoResource', () => {
  it('gets and updates item seo', async () => {
    const get = vi.fn().mockResolvedValue({
      seo: {
        metaTitle: 'Hello',
        structuredData: { '@context': 'https://schema.org' },
      },
    })
    const patch = vi.fn().mockResolvedValue({
      seo: {
        metaTitle: 'Updated',
        structuredData: { '@type': 'Article' },
      },
    })
    const http = { get, patch } as unknown as HttpClient
    const resource = new ItemSeoResource(http)

    await expect(resource.get('blog', 'hello-world', { locale: 'en' })).resolves.toEqual({
      metaTitle: 'Hello',
      structuredData: { '@context': 'https://schema.org' },
    })
    await expect(
      resource.update('blog', 'hello-world', {
        metaTitle: 'Updated',
        structuredData: { '@type': 'Article' },
      }),
    ).resolves.toEqual({
      metaTitle: 'Updated',
      structuredData: { '@type': 'Article' },
    })

    expect(get).toHaveBeenCalledWith('/collections/blog/items/hello-world/seo', {
      params: { locale: 'en' },
    })
    expect(patch).toHaveBeenCalledWith('/collections/blog/items/hello-world/seo', {
      metaTitle: 'Updated',
      structuredData: { '@type': 'Article' },
    })
  })
})
