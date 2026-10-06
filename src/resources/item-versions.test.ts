import { describe, expect, it, vi } from 'vitest'

import { ItemVersionsResource } from './item-versions'
import type { HttpClient } from '../http'

describe('ItemVersionsResource', () => {
  it('lists versions for an item', async () => {
    const get = vi.fn().mockResolvedValue({ versions: [] })
    const http = { get } as unknown as HttpClient
    const resource = new ItemVersionsResource(http)

    await resource.list('blog', 'hello-world')

    expect(get).toHaveBeenCalledWith('/collections/blog/items/hello-world/versions')
  })

  it('gets a specific version by ID', async () => {
    const get = vi.fn().mockResolvedValue({ version: { id: 'v1', number: 1 } })
    const http = { get } as unknown as HttpClient
    const resource = new ItemVersionsResource(http)

    const result = await resource.get('blog', 'hello-world', 'v1')

    expect(get).toHaveBeenCalledWith('/collections/blog/items/hello-world/versions/v1')
    expect(result).toEqual({ id: 'v1', number: 1 })
  })

  it('creates a draft with optional note', async () => {
    const post = vi.fn().mockResolvedValue({ version: { id: 'v2', status: 'DRAFT' } })
    const http = { post } as unknown as HttpClient
    const resource = new ItemVersionsResource(http)

    const result = await resource.createDraft('blog', 'hello-world', { note: 'My draft' })

    expect(post).toHaveBeenCalledWith('/collections/blog/items/hello-world/versions', {
      note: 'My draft',
    })
    expect(result).toEqual({ id: 'v2', status: 'DRAFT' })
  })

  it('creates a draft without input', async () => {
    const post = vi.fn().mockResolvedValue({ version: { id: 'v2', status: 'DRAFT' } })
    const http = { post } as unknown as HttpClient
    const resource = new ItemVersionsResource(http)

    await resource.createDraft('blog', 'hello-world')

    expect(post).toHaveBeenCalledWith('/collections/blog/items/hello-world/versions', undefined)
  })

  it('updates a draft with values', async () => {
    const put = vi.fn().mockResolvedValue({ version: { id: 'v2', values: [] } })
    const http = { put } as unknown as HttpClient
    const resource = new ItemVersionsResource(http)

    const result = await resource.updateDraft('blog', 'hello-world', {
      values: { title: 'Updated' },
      locale: 'en',
    })

    expect(put).toHaveBeenCalledWith('/collections/blog/items/hello-world/versions/draft', {
      values: { title: 'Updated' },
      locale: 'en',
    })
    expect(result).toEqual({ id: 'v2', values: [] })
  })

  it('updates a draft with a new slug', async () => {
    const put = vi.fn().mockResolvedValue({ version: { id: 'v2' } })
    const http = { put } as unknown as HttpClient
    const resource = new ItemVersionsResource(http)

    await resource.updateDraft('blog', 'hello-world', {
      slug: 'new-slug',
    })

    expect(put).toHaveBeenCalledWith('/collections/blog/items/hello-world/versions/draft', {
      slug: 'new-slug',
    })
  })

  it('discards a draft', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    const http = { delete: del } as unknown as HttpClient
    const resource = new ItemVersionsResource(http)

    await resource.discardDraft('blog', 'hello-world')

    expect(del).toHaveBeenCalledWith('/collections/blog/items/hello-world/versions/draft')
  })

  it('publishes a draft', async () => {
    const post = vi.fn().mockResolvedValue({ version: { id: 'v2', status: 'PUBLISHED' } })
    const http = { post } as unknown as HttpClient
    const resource = new ItemVersionsResource(http)

    const result = await resource.publishDraft('blog', 'hello-world')

    expect(post).toHaveBeenCalledWith('/collections/blog/items/hello-world/versions/draft/publish')
    expect(result).toEqual({ id: 'v2', status: 'PUBLISHED' })
  })

  it('rolls back to a historical version', async () => {
    const post = vi.fn().mockResolvedValue({ version: { id: 'v3', restoredFromVersionNumber: 1 } })
    const http = { post } as unknown as HttpClient
    const resource = new ItemVersionsResource(http)

    const result = await resource.rollback('blog', 'hello-world', 'v1')

    expect(post).toHaveBeenCalledWith('/collections/blog/items/hello-world/versions/v1/rollback')
    expect(result).toEqual({ id: 'v3', restoredFromVersionNumber: 1 })
  })
})
