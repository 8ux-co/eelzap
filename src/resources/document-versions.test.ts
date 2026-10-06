import { describe, expect, it, vi } from 'vitest'

import { DocumentVersionsResource } from './document-versions'
import type { HttpClient } from '../http'

describe('DocumentVersionsResource', () => {
  it('lists versions for a document', async () => {
    const get = vi.fn().mockResolvedValue({ versions: [] })
    const http = { get } as unknown as HttpClient
    const resource = new DocumentVersionsResource(http)

    await resource.list('homepage')

    expect(get).toHaveBeenCalledWith('/documents/homepage/versions')
  })

  it('gets a specific version by ID', async () => {
    const get = vi.fn().mockResolvedValue({ version: { id: 'v1', number: 1 } })
    const http = { get } as unknown as HttpClient
    const resource = new DocumentVersionsResource(http)

    const result = await resource.get('homepage', 'v1')

    expect(get).toHaveBeenCalledWith('/documents/homepage/versions/v1')
    expect(result).toEqual({ id: 'v1', number: 1 })
  })

  it('creates a draft with optional note', async () => {
    const post = vi.fn().mockResolvedValue({ version: { id: 'v2', status: 'DRAFT' } })
    const http = { post } as unknown as HttpClient
    const resource = new DocumentVersionsResource(http)

    const result = await resource.createDraft('homepage', { note: 'My draft' })

    expect(post).toHaveBeenCalledWith('/documents/homepage/versions', { note: 'My draft' })
    expect(result).toEqual({ id: 'v2', status: 'DRAFT' })
  })

  it('creates a draft without input', async () => {
    const post = vi.fn().mockResolvedValue({ version: { id: 'v2', status: 'DRAFT' } })
    const http = { post } as unknown as HttpClient
    const resource = new DocumentVersionsResource(http)

    await resource.createDraft('homepage')

    expect(post).toHaveBeenCalledWith('/documents/homepage/versions', undefined)
  })

  it('updates a draft with values', async () => {
    const put = vi.fn().mockResolvedValue({ version: { id: 'v2', values: [] } })
    const http = { put } as unknown as HttpClient
    const resource = new DocumentVersionsResource(http)

    const result = await resource.updateDraft('homepage', {
      values: { title: 'Updated' },
      locale: 'en',
    })

    expect(put).toHaveBeenCalledWith('/documents/homepage/versions/draft', {
      values: { title: 'Updated' },
      locale: 'en',
    })
    expect(result).toEqual({ id: 'v2', values: [] })
  })

  it('discards a draft', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    const http = { delete: del } as unknown as HttpClient
    const resource = new DocumentVersionsResource(http)

    await resource.discardDraft('homepage')

    expect(del).toHaveBeenCalledWith('/documents/homepage/versions/draft')
  })

  it('publishes a draft', async () => {
    const post = vi.fn().mockResolvedValue({ version: { id: 'v2', status: 'PUBLISHED' } })
    const http = { post } as unknown as HttpClient
    const resource = new DocumentVersionsResource(http)

    const result = await resource.publishDraft('homepage')

    expect(post).toHaveBeenCalledWith('/documents/homepage/versions/draft/publish')
    expect(result).toEqual({ id: 'v2', status: 'PUBLISHED' })
  })

  it('rolls back to a historical version', async () => {
    const post = vi.fn().mockResolvedValue({ version: { id: 'v3', restoredFromVersionNumber: 1 } })
    const http = { post } as unknown as HttpClient
    const resource = new DocumentVersionsResource(http)

    const result = await resource.rollback('homepage', 'v1')

    expect(post).toHaveBeenCalledWith('/documents/homepage/versions/v1/rollback')
    expect(result).toEqual({ id: 'v3', restoredFromVersionNumber: 1 })
  })
})
