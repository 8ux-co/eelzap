import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '../http'
import { DocumentFieldsResource } from './document-fields'

describe('DocumentFieldsResource', () => {
  it('lists, gets, creates, updates, deletes, and reorders document fields', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ fields: [{ id: 'field_1' }] })
      .mockResolvedValueOnce({ field: { id: 'field_1' } })
    const post = vi
      .fn()
      .mockResolvedValueOnce({ field: { id: 'field_1' } })
      .mockResolvedValueOnce({ success: true })
    const patch = vi.fn().mockResolvedValue({ field: { id: 'field_1', label: 'Headline' } })
    const del = vi.fn().mockResolvedValue({ success: true })
    const http = { get, post, patch, delete: del } as unknown as HttpClient
    const resource = new DocumentFieldsResource(http)

    await expect(resource.list('homepage')).resolves.toEqual([{ id: 'field_1' }])
    await expect(resource.get('homepage', 'field_1')).resolves.toEqual({ id: 'field_1' })
    await expect(
      resource.create('homepage', { key: 'hero_title', name: 'Hero Title', type: 'TEXT' }),
    ).resolves.toEqual({ id: 'field_1' })
    await expect(resource.update('homepage', 'field_1', { name: 'Headline' })).resolves.toEqual({
      id: 'field_1',
      label: 'Headline',
    })
    await expect(resource.delete('homepage', 'field_1')).resolves.toEqual({ success: true })
    await expect(resource.reorder('homepage', ['field_1'])).resolves.toEqual({ success: true })

    expect(post).toHaveBeenNthCalledWith(2, '/documents/homepage/fields/reorder', {
      fieldIds: ['field_1'],
    })
  })

  it('passes multi-currency constraints through unchanged', async () => {
    const post = vi.fn().mockResolvedValue({ field: { id: 'field_price' } })
    const patch = vi.fn().mockResolvedValue({ field: { id: 'field_price' } })
    const http = { post, patch } as unknown as HttpClient
    const resource = new DocumentFieldsResource(http)

    await resource.create('pricing-page', {
      key: 'price',
      label: 'Price',
      type: 'CURRENCY',
      constraints: {
        currencies: ['USD', 'EUR'],
      },
    })

    await resource.update('pricing-page', 'field_price', {
      constraints: {
        currencies: ['USD', 'EUR', 'COP'],
      },
    })

    expect(post).toHaveBeenCalledWith(
      '/documents/pricing-page/fields',
      {
        key: 'price',
        label: 'Price',
        type: 'CURRENCY',
        constraints: {
          currencies: ['USD', 'EUR'],
        },
      },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    )
    expect(patch).toHaveBeenCalledWith('/documents/pricing-page/fields/field_price', {
      constraints: {
        currencies: ['USD', 'EUR', 'COP'],
      },
    })
  })
})

describe('DocumentFieldsResource archive', () => {
  it('lists deleted fields from `…/fields/deleted` and restores one by POST', async () => {
    const get = vi.fn().mockResolvedValue({ fields: [{ id: 'field_9' }] })
    const post = vi.fn().mockResolvedValue({ field: { id: 'field_9' } })
    const resource = new DocumentFieldsResource({ get, post } as unknown as HttpClient)

    await expect(resource.listDeleted('home')).resolves.toEqual([{ id: 'field_9' }])
    await expect(resource.restore('home', 'field_9')).resolves.toEqual({ id: 'field_9' })

    expect(get).toHaveBeenCalledWith('/documents/home/fields/deleted')
    expect(post).toHaveBeenCalledWith('/documents/home/fields/field_9/restore')
  })
})
