import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '../http'
import { DocumentSectionsResource } from './document-sections'

describe('DocumentSectionsResource', () => {
  it('lists, gets, creates, updates, and deletes document sections', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ sections: [{ id: 'section_1' }] })
      .mockResolvedValueOnce({ section: { id: 'section_1' } })
    const post = vi.fn().mockResolvedValue({ section: { id: 'section_1' } })
    const patch = vi.fn().mockResolvedValue({ section: { id: 'section_1', name: 'Hero' } })
    const del = vi.fn().mockResolvedValue({ success: true })
    const http = { get, post, patch, delete: del } as unknown as HttpClient
    const resource = new DocumentSectionsResource(http)

    await expect(resource.list('homepage')).resolves.toEqual([{ id: 'section_1' }])
    await expect(resource.get('homepage', 'section_1')).resolves.toEqual({ id: 'section_1' })
    await expect(resource.create('homepage', { name: 'Hero Section' })).resolves.toEqual({
      id: 'section_1',
    })
    await expect(resource.update('homepage', 'section_1', { name: 'Hero' })).resolves.toEqual({
      id: 'section_1',
      name: 'Hero',
    })
    await expect(resource.delete('homepage', 'section_1')).resolves.toEqual({ success: true })
  })
})
