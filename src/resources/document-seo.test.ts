import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '../http'
import { DocumentSeoResource } from './document-seo'

describe('DocumentSeoResource', () => {
  it('gets and updates document seo', async () => {
    const get = vi.fn().mockResolvedValue({
      seo: {
        metaTitle: 'Homepage',
        structuredData: { '@context': 'https://schema.org' },
      },
    })
    const put = vi.fn().mockResolvedValue({
      seo: {
        metaTitle: 'Updated',
        structuredData: { '@type': 'WebPage' },
      },
    })
    const http = { get, put } as unknown as HttpClient
    const resource = new DocumentSeoResource(http)

    await expect(resource.get('homepage', { locale: '*' })).resolves.toEqual({
      metaTitle: 'Homepage',
      structuredData: { '@context': 'https://schema.org' },
    })
    await expect(
      resource.update('homepage', {
        metaTitle: 'Updated',
        structuredData: { '@type': 'WebPage' },
      }),
    ).resolves.toEqual({
      metaTitle: 'Updated',
      structuredData: { '@type': 'WebPage' },
    })

    expect(put).toHaveBeenCalledWith('/documents/homepage/seo', {
      metaTitle: 'Updated',
      structuredData: { '@type': 'WebPage' },
    })
  })
})
