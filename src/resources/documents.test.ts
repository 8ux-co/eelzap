import { describe, expect, it, vi } from 'vitest'

import { DocumentsResource } from './documents'
import type { HttpClient } from '../http'

describe('DocumentsResource', () => {
  it('lists documents with locale and status', async () => {
    const get = vi.fn().mockResolvedValue({ data: [] })
    const http = { get } as unknown as HttpClient
    const resource = new DocumentsResource(http, { locale: 'en', status: 'published' })

    await resource.list()

    expect(get).toHaveBeenCalledWith('/documents', {
      params: {
        locale: 'en',
        status: 'published',
      },
    })
  })

  it('gets a single document with sparse fields', async () => {
    const get = vi.fn().mockResolvedValue({ key: 'homepage' })
    const http = { get } as unknown as HttpClient
    const resource = new DocumentsResource(http, {})

    await resource.get('homepage', {
      locale: 'en',
      status: 'draft',
      fields: ['hero_title'],
    })

    expect(get).toHaveBeenCalledWith('/documents/homepage', {
      params: {
        locale: 'en',
        status: 'draft',
        fields: 'hero_title',
      },
    })
  })

  it('creates, updates, deletes, publishes, and unpublishes documents', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ document: { key: 'homepage' } })
      .mockResolvedValueOnce({ document: { key: 'homepage', status: 'PUBLISHED' } })
      .mockResolvedValueOnce({ document: { key: 'homepage', status: 'DRAFT' } })
    const patch = vi.fn().mockResolvedValue({ document: { key: 'homepage' } })
    const del = vi.fn().mockResolvedValue({ success: true })
    const http = { post, patch, delete: del } as unknown as HttpClient
    const resource = new DocumentsResource(http, {})

    await expect(resource.create({ name: 'Homepage', key: 'homepage' })).resolves.toEqual({
      key: 'homepage',
    })
    await expect(resource.update('homepage', { name: 'Home' })).resolves.toEqual({
      key: 'homepage',
    })
    await expect(resource.delete('homepage', { deleteMediaIds: ['media_1'] })).resolves.toEqual({
      success: true,
    })
    await expect(resource.publish('homepage')).resolves.toEqual({
      key: 'homepage',
      status: 'PUBLISHED',
    })
    await expect(resource.unpublish('homepage')).resolves.toEqual({
      key: 'homepage',
      status: 'DRAFT',
    })

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/documents',
      {
        name: 'Homepage',
        key: 'homepage',
      },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    )
    expect(patch).toHaveBeenCalledWith('/documents/homepage', { name: 'Home' })
    expect(del).toHaveBeenCalledWith('/documents/homepage', {
      deleteMediaIds: ['media_1'],
    })
    expect(post).toHaveBeenNthCalledWith(2, '/documents/homepage/publish')
    expect(post).toHaveBeenNthCalledWith(3, '/documents/homepage/unpublish')
    expect(resource.fields).toBeDefined()
    expect(resource.sections).toBeDefined()
    expect(resource.values).toBeDefined()
    expect(resource.seo).toBeDefined()
  })
})
