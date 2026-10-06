import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '../http'
import { CollectionFieldsResource } from './collection-fields'

describe('CollectionFieldsResource', () => {
  it('lists, creates, updates, deletes, and reorders collection fields', async () => {
    const get = vi.fn().mockResolvedValue({ fields: [{ id: 'field_1' }] })
    const post = vi.fn().mockResolvedValue({ field: { id: 'field_1', label: 'Title' } })
    const patch = vi.fn().mockResolvedValue({ field: { id: 'field_1', label: 'Post Title' } })
    const del = vi.fn().mockResolvedValue({ success: true })
    const put = vi.fn().mockResolvedValue({ success: true })
    const http = { get, post, patch, delete: del, put } as unknown as HttpClient
    const resource = new CollectionFieldsResource(http)

    await expect(resource.list('blog')).resolves.toEqual([{ id: 'field_1' }])
    await expect(
      resource.create('blog', { key: 'title', name: 'Title', type: 'TEXT' }),
    ).resolves.toEqual({ id: 'field_1', label: 'Title' })
    await expect(resource.update('blog', 'field_1', { name: 'Post Title' })).resolves.toEqual({
      id: 'field_1',
      label: 'Post Title',
    })
    await expect(resource.delete('blog', 'field_1')).resolves.toEqual({ success: true })
    await expect(resource.reorder('blog', ['field_1'])).resolves.toEqual({ success: true })

    expect(post).toHaveBeenCalledWith(
      '/collections/blog/fields',
      {
        key: 'title',
        name: 'Title',
        type: 'TEXT',
        label: 'Title',
      },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    )
    expect(patch).toHaveBeenCalledWith('/collections/blog/fields/field_1', {
      name: 'Post Title',
      label: 'Post Title',
    })
    expect(put).toHaveBeenCalledWith('/collections/blog/fields/reorder', { fieldIds: ['field_1'] })
  })

  it('passes multi-currency constraints through unchanged', async () => {
    const post = vi.fn().mockResolvedValue({ field: { id: 'field_price' } })
    const patch = vi.fn().mockResolvedValue({ field: { id: 'field_price' } })
    const http = { post, patch } as unknown as HttpClient
    const resource = new CollectionFieldsResource(http)

    await resource.create('properties', {
      key: 'price',
      label: 'Price',
      type: 'CURRENCY',
      constraints: {
        currencies: ['USD', 'EUR', 'COP'],
      },
    })

    await resource.update('properties', 'field_price', {
      constraints: {
        currencies: ['USD', 'COP'],
      },
    })

    expect(post).toHaveBeenCalledWith(
      '/collections/properties/fields',
      {
        key: 'price',
        label: 'Price',
        type: 'CURRENCY',
        constraints: {
          currencies: ['USD', 'EUR', 'COP'],
        },
      },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    )
    expect(patch).toHaveBeenCalledWith('/collections/properties/fields/field_price', {
      constraints: {
        currencies: ['USD', 'COP'],
      },
    })
  })
})

describe('CollectionFieldsResource archive', () => {
  it('lists deleted fields from `…/fields/deleted` and restores one by POST', async () => {
    const get = vi.fn().mockResolvedValue({ fields: [{ id: 'field_9' }] })
    const post = vi.fn().mockResolvedValue({ field: { id: 'field_9' } })
    const resource = new CollectionFieldsResource({ get, post } as unknown as HttpClient)

    await expect(resource.listDeleted('blog')).resolves.toEqual([{ id: 'field_9' }])
    await expect(resource.restore('blog', 'field_9')).resolves.toEqual({ id: 'field_9' })

    expect(get).toHaveBeenCalledWith('/collections/blog/fields/deleted')
    expect(post).toHaveBeenCalledWith('/collections/blog/fields/field_9/restore')
  })
})
