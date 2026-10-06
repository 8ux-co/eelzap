import { describe, expect, it } from 'vitest'

import {
  cleanParams,
  maskApiKey,
  mergeRequestOptions,
  normalizeHeaderValue,
  normalizeBaseUrl,
  serializeFilters,
  toArrayParam,
} from './utils'

describe('utils', () => {
  it('normalizes base urls and array params', () => {
    expect(normalizeBaseUrl('https://api.eelzap.com')).toBe('https://api.eelzap.com/')
    expect(normalizeBaseUrl('https://api.eelzap.com/')).toBe('https://api.eelzap.com/')
    expect(toArrayParam(['title', 'price'])).toBe('title,price')
    expect(toArrayParam([])).toBeUndefined()
    expect(toArrayParam(undefined)).toBeUndefined()
  })

  it('merges request options and removes undefined params', () => {
    expect(
      mergeRequestOptions(
        { locale: 'en', status: 'published' },
        { status: 'draft', fields: ['title'] },
      ),
    ).toEqual({
      locale: 'en',
      status: 'draft',
      fields: ['title'],
    })

    expect(
      cleanParams({
        locale: 'en',
        page: 2,
        published: true,
        empty: undefined,
      }),
    ).toEqual({
      locale: 'en',
      page: '2',
      published: 'true',
    })
  })

  it('serializes primitive and operator filters', () => {
    expect(serializeFilters()).toEqual({})
    expect(
      serializeFilters({
        category: 'news',
        price: { gte: 100, lte: 200, in: ['100', '200'], contains: undefined },
        featured: { eq: true, ne: undefined },
      }),
    ).toEqual({
      'filter[category]': 'news',
      'filter[price][gte]': '100',
      'filter[price][lte]': '200',
      'filter[price][in]': '100,200',
      'filter[featured][eq]': 'true',
    })
  })

  it('masks short and long api keys', () => {
    expect(maskApiKey('short')).toBe('***')
    expect(maskApiKey('secret_12345678')).toBe('secr...5678')
  })

  it('normalizes optional header values', () => {
    expect(normalizeHeaderValue(undefined)).toBeUndefined()
    expect(normalizeHeaderValue(null)).toBeUndefined()
    expect(normalizeHeaderValue('   ')).toBeUndefined()
    expect(normalizeHeaderValue(' Hero ')).toBe('Hero')
  })
})
