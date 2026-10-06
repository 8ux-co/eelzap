import { describe, expect, it } from 'vitest'

import { getMediaUrl } from './media-url'

// The three `mediaAccess` states the delivery API emits (content-delivery.ts).

describe('getMediaUrl', () => {
  it('returns the public url of a published file', () => {
    expect(getMediaUrl({ url: 'https://cdn.example/a.jpg', signedUrl: null })).toBe(
      'https://cdn.example/a.jpg',
    )
  })

  it('returns the signed url of a draft the key may read', () => {
    expect(getMediaUrl({ url: null, signedUrl: 'https://r2.example/a.jpg?sig=1' })).toBe(
      'https://r2.example/a.jpg?sig=1',
    )
  })

  it('prefers the public url when both are present', () => {
    expect(
      getMediaUrl({ url: 'https://cdn.example/a.jpg', signedUrl: 'https://r2.example/a' }),
    ).toBe('https://cdn.example/a.jpg')
  })

  it('returns null for a draft the key cannot read, and for no media', () => {
    expect(getMediaUrl({ url: null, signedUrl: null })).toBeNull()
    expect(getMediaUrl(null)).toBeNull()
    expect(getMediaUrl(undefined)).toBeNull()
  })
})
