import { describe, expect, it, vi } from 'vitest'

import { CollectionsResource } from './collections'
import type { HttpClient } from '../http'

describe('CollectionsResource', () => {
  it('lists collections with merged defaults', async () => {
    const get = vi.fn().mockResolvedValue({ data: [] })
    const http = { get } as unknown as HttpClient
    const resource = new CollectionsResource(http, { status: 'published' })

    await resource.list()

    expect(get).toHaveBeenCalledWith('/collections', {
      params: {
        status: 'published',
      },
    })
  })

  it('gets a single collection by key', async () => {
    const get = vi.fn().mockResolvedValue({ key: 'blog' })
    const http = { get } as unknown as HttpClient
    const resource = new CollectionsResource(http, {})

    await resource.get('blog', { status: 'draft' })

    expect(get).toHaveBeenCalledWith('/collections/blog', {
      params: {
        status: 'draft',
      },
    })
  })

  it('accepts an explicit status override when listing collections', async () => {
    const get = vi.fn().mockResolvedValue({ data: [] })
    const http = { get } as unknown as HttpClient
    const resource = new CollectionsResource(http, { status: 'published' })

    await resource.list({ status: 'draft' })

    expect(get).toHaveBeenCalledWith('/collections', {
      params: {
        status: 'draft',
      },
    })
  })

  it('passes through undefined status when no default or override is set', async () => {
    const get = vi.fn().mockResolvedValue({ key: 'blog' })
    const http = { get } as unknown as HttpClient
    const resource = new CollectionsResource(http, {})

    await resource.get('blog')

    expect(get).toHaveBeenCalledWith('/collections/blog', {
      params: {
        status: undefined,
      },
    })
  })

  it('creates, updates, and deletes collections and exposes nested resources', async () => {
    const post = vi.fn().mockResolvedValue({ collection: { key: 'blog' } })
    const patch = vi.fn().mockResolvedValue({ collection: { key: 'blog' } })
    const del = vi.fn().mockResolvedValue({ success: true })
    const http = { post, patch, delete: del } as unknown as HttpClient
    const resource = new CollectionsResource(http, {})

    await expect(resource.create({ name: 'Blog', key: 'blog' })).resolves.toEqual({ key: 'blog' })
    await expect(resource.update('blog', { name: 'Posts' })).resolves.toEqual({ key: 'blog' })
    await expect(resource.delete('blog', { deleteMediaIds: ['media_1'] })).resolves.toEqual({
      success: true,
    })

    expect(post).toHaveBeenCalledWith(
      '/collections',
      { name: 'Blog', key: 'blog' },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    )
    expect(patch).toHaveBeenCalledWith('/collections/blog', { name: 'Posts' })
    expect(del).toHaveBeenCalledWith('/collections/blog', { deleteMediaIds: ['media_1'] })
    expect(resource.fields).toBeDefined()
    expect(resource.sections).toBeDefined()
  })
})
