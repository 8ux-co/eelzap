import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '../http'
import { CollectionSectionsResource } from './collection-sections'

describe('CollectionSectionsResource', () => {
  it('lists, gets, creates, updates, and deletes collection sections', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ sections: [{ id: 'section_1' }] })
      .mockResolvedValueOnce({ section: { id: 'section_1' } })
    const post = vi.fn().mockResolvedValue({ section: { id: 'section_1' } })
    const patch = vi.fn().mockResolvedValue({ section: { id: 'section_1', name: 'Main' } })
    const del = vi.fn().mockResolvedValue({ success: true })
    const http = { get, post, patch, delete: del } as unknown as HttpClient
    const resource = new CollectionSectionsResource(http)

    await expect(resource.list('blog')).resolves.toEqual([{ id: 'section_1' }])
    await expect(resource.get('blog', 'section_1')).resolves.toEqual({ id: 'section_1' })
    await expect(resource.create('blog', { name: 'Content' })).resolves.toEqual({
      id: 'section_1',
    })
    await expect(resource.update('blog', 'section_1', { name: 'Main' })).resolves.toEqual({
      id: 'section_1',
      name: 'Main',
    })
    await expect(resource.delete('blog', 'section_1')).resolves.toEqual({ success: true })
  })
})
