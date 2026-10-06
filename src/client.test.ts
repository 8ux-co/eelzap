import { describe, expect, it, vi } from 'vitest'

import { EelZapClient, createClient } from './client'

describe('EelZapClient', () => {
  it('creates a client through the factory', () => {
    const client = createClient({
      apiKey: 'secret_12345678',
      fetch: vi.fn(),
    })

    expect(client).toBeInstanceOf(EelZapClient)
    expect(client.site).toBeDefined()
    expect(client.collections).toBeDefined()
    expect(client.collections.fields).toBeDefined()
    expect(client.collections.sections).toBeDefined()
    expect(client.items).toBeDefined()
    expect(client.items.seo).toBeDefined()
    expect(client.documents).toBeDefined()
    expect(client.documents.fields).toBeDefined()
    expect(client.documents.sections).toBeDefined()
    expect(client.documents.values).toBeDefined()
    expect(client.documents.seo).toBeDefined()
    expect(client.media).toBeDefined()
  })

  it('masks the API key in string output', () => {
    const client = new EelZapClient({
      apiKey: 'secret_12345678',
      baseUrl: 'https://api.eelzap.com',
      pathPrefix: '/api/public/v1',
      fetch: vi.fn(),
    })

    expect(client.toString()).toContain('pathPrefix=/api/public/v1')
    expect(client.toString()).toContain('secr...5678')
    expect(client.toString()).not.toContain('secret_12345678')
  })

  it('requires an API key', () => {
    expect(
      () =>
        new EelZapClient({
          apiKey: '',
          fetch: vi.fn(),
        }),
    ).toThrow('apiKey is required.')
  })

  it('requires a fetch implementation when none is available globally', () => {
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', undefined)

    try {
      expect(
        () =>
          new EelZapClient({
            apiKey: 'secret_12345678',
          }),
      ).toThrow('A fetch implementation is required.')
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })
})
