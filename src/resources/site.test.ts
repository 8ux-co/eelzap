import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '../http'
import { SiteResource } from './site'

describe('SiteResource', () => {
  it('gets the current site', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'site_1' })
    const http = { get } as unknown as HttpClient
    const resource = new SiteResource(http)

    await expect(resource.get()).resolves.toEqual({ id: 'site_1' })
    expect(get).toHaveBeenCalledWith('/site')
  })

  it('updates the site with PATCH /site', async () => {
    const patch = vi.fn().mockResolvedValue({ id: 'site_1', url: 'https://example.com' })
    const http = { patch } as unknown as HttpClient
    const resource = new SiteResource(http)

    const input = { url: 'https://example.com', previewOrigins: ['http://localhost:3000'] }
    await expect(resource.update(input)).resolves.toEqual({
      id: 'site_1',
      url: 'https://example.com',
    })
    expect(patch).toHaveBeenCalledWith('/site', input)
  })
})
