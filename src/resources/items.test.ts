import { describe, expect, it, vi } from 'vitest'

import { ItemsResource } from './items'
import type { HttpClient } from '../http'

describe('ItemsResource', () => {
  it('serializes list params including filters and sparse fields', async () => {
    const get = vi.fn().mockResolvedValue({ data: [] })
    const http = { get } as unknown as HttpClient
    const resource = new ItemsResource(http, { locale: 'en', status: 'published' })

    await resource.list('products', {
      page: 1,
      pageSize: 20,
      sort: '-price',
      fields: ['title', 'price'],
      filter: {
        category: 'electronics',
        price: { gte: 100, lt: 500 },
        featured: { eq: true },
      },
    })

    expect(get).toHaveBeenCalledWith('/collections/products/items', {
      params: {
        locale: 'en',
        status: 'published',
        fields: 'title,price',
        page: 1,
        pageSize: 20,
        sort: '-price',
        'filter[category]': 'electronics',
        'filter[price][gte]': '100',
        'filter[price][lt]': '500',
        'filter[featured][eq]': 'true',
      },
    })
  })

  it('gets a single item', async () => {
    const get = vi.fn().mockResolvedValue({ slug: 'hello-world' })
    const http = { get } as unknown as HttpClient
    const resource = new ItemsResource(http, {})

    await resource.get('blog', 'hello-world', {
      locale: 'es',
      status: 'draft',
      fields: ['title'],
    })

    expect(get).toHaveBeenCalledWith('/collections/blog/items/hello-world', {
      params: {
        locale: 'es',
        status: 'draft',
        fields: 'title',
      },
    })
  })

  it('creates a fluent collection query builder', () => {
    const get = vi.fn()
    const http = { get } as unknown as HttpClient
    const resource = new ItemsResource(http, { locale: 'en' })

    const query = resource.collection('products').page(3)

    expect(query.toJSON()).toEqual({ page: 3 })
  })

  it('creates, updates, deletes, publishes, and unpublishes items', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ item: { slug: 'hello-world' } })
      .mockResolvedValueOnce({ item: { slug: 'hello-world', status: 'PUBLISHED' } })
      .mockResolvedValueOnce({ item: { slug: 'hello-world', status: 'DRAFT' } })
    const patch = vi.fn().mockResolvedValue({ item: { slug: 'hello-world' } })
    const del = vi.fn().mockResolvedValue({ success: true })
    const http = { post, patch, delete: del } as unknown as HttpClient
    const resource = new ItemsResource(http, {})

    await expect(
      resource.create('blog', { slug: 'hello-world', values: { title: 'Hello' } }),
    ).resolves.toEqual({ slug: 'hello-world' })
    await expect(
      resource.update('blog', 'hello-world', { values: { title: 'Hello 2' } }),
    ).resolves.toEqual({ slug: 'hello-world' })
    await expect(
      resource.delete('blog', 'hello-world', { deleteMediaIds: ['media_1'] }),
    ).resolves.toEqual({ success: true })
    await expect(resource.publish('blog', 'hello-world')).resolves.toEqual({
      slug: 'hello-world',
      status: 'PUBLISHED',
    })
    await expect(resource.unpublish('blog', 'hello-world')).resolves.toEqual({
      slug: 'hello-world',
      status: 'DRAFT',
    })

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/collections/blog/items',
      {
        slug: 'hello-world',
        values: { title: 'Hello' },
      },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    )
    expect(patch).toHaveBeenCalledWith('/collections/blog/items/hello-world', {
      values: { title: 'Hello 2' },
    })
    expect(del).toHaveBeenCalledWith('/collections/blog/items/hello-world', {
      deleteMediaIds: ['media_1'],
    })
    expect(post).toHaveBeenNthCalledWith(2, '/collections/blog/items/hello-world/publish')
    expect(post).toHaveBeenNthCalledWith(3, '/collections/blog/items/hello-world/unpublish')
    expect(resource.seo).toBeDefined()
  })
})
