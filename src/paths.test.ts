import { describe, expect, it } from 'vitest'

import { buildResourcePath, normalizePathPrefix } from './paths'

describe('paths', () => {
  it('builds resource paths from trimmed segments', () => {
    expect(buildResourcePath('collections', '/blog/', 'items')).toBe('/collections/blog/items')
  })

  it('normalizes path prefixes and supports empty prefixes', () => {
    expect(normalizePathPrefix('/api/public/v1/')).toBe('api/public/v1/')
    expect(normalizePathPrefix('/')).toBe('')
  })
})
