import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { createClient } from '../client'
import type { PreviewTokenValidation } from '../types/common'

const TOKEN = `zpt_${'A'.repeat(43)}`

function client(answer: unknown, status = 200) {
  const fetch = vi.fn(async () => Response.json(answer, { status }))
  const sdk = createClient({ apiKey: TOKEN, baseUrl: 'https://zap.test', fetch })
  const sent = () =>
    fetch.mock.calls.map((call) => {
      const [url, init] = call as unknown as [string, RequestInit]
      return { method: init.method, url: new URL(url), headers: new Headers(init.headers) }
    })
  return { sdk, sent }
}

describe('PreviewTokensResource', () => {
  it('validates the client’s token against the site key, sent as X-Zap-Site-Api-Key', async () => {
    const answer = { site: { key: 'verdeorigen' }, expiresAt: '2026-10-05T12:10:00.000Z' }
    const { sdk, sent } = client(answer)

    const result = await sdk.previewTokens.validate('public_abc')

    expectTypeOf(result).toEqualTypeOf<PreviewTokenValidation>()
    expect(result).toEqual(answer)
    const [call] = sent()
    expect(call!.method).toBe('GET')
    expect(call!.url.pathname).toBe('/v1/preview/token')
    // No preview param: the route is not a delivery read.
    expect(call!.url.search).toBe('')
    expect(call!.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(call!.headers.get('X-Zap-Site-Api-Key')).toBe('public_abc')
  })

  it('rejects another site’s token with the route’s WRONG_SITE', async () => {
    const { sdk } = client(
      { error: { code: 'WRONG_SITE', message: 'another site', status: 403 } },
      403,
    )
    await expect(sdk.previewTokens.validate('public_abc')).rejects.toMatchObject({
      code: 'WRONG_SITE',
      status: 403,
    })
  })
})
