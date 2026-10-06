import { describe, expect, it, vi } from 'vitest'

import * as sdk from './index'

describe('index exports', () => {
  it('re-exports the public api surface', () => {
    expect(sdk.createClient).toBeTypeOf('function')
    expect(sdk.EelZapClient).toBeTypeOf('function')
    expect(sdk.EelZapError).toBeTypeOf('function')
    expect(sdk.EelZapNetworkError).toBeTypeOf('function')
    expect(sdk.verifyWebhookSignature).toBeTypeOf('function')
    expect(sdk.webhookChanges).toBeTypeOf('function')
    expect(sdk.getMediaUrl).toBeTypeOf('function')
    expect(sdk.ItemVersionsResource).toBeTypeOf('function')
    expect(sdk.DocumentVersionsResource).toBeTypeOf('function')
    expect(sdk.ItemQueryBuilder).toBeTypeOf('function')
    expect(sdk.SiteResource).toBeTypeOf('function')
    expect(sdk.CollectionsResource).toBeTypeOf('function')
    expect(sdk.CollectionFieldsResource).toBeTypeOf('function')
    expect(sdk.CollectionSectionsResource).toBeTypeOf('function')
    expect(sdk.ItemsResource).toBeTypeOf('function')
    expect(sdk.ItemSeoResource).toBeTypeOf('function')
    expect(sdk.DocumentsResource).toBeTypeOf('function')
    expect(sdk.DocumentFieldsResource).toBeTypeOf('function')
    expect(sdk.DocumentSectionsResource).toBeTypeOf('function')
    expect(sdk.DocumentValuesResource).toBeTypeOf('function')
    expect(sdk.DocumentSeoResource).toBeTypeOf('function')
    expect(sdk.MediaResource).toBeTypeOf('function')
  })

  it('creates a client from the barrel export', () => {
    const client = sdk.createClient({
      apiKey: 'secret_12345678',
      fetch: vi.fn(),
    })

    expect(client).toBeInstanceOf(sdk.EelZapClient)
  })
})
