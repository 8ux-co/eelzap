import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '../http'
import { DocumentValuesResource } from './document-values'

describe('DocumentValuesResource', () => {
  it('gets and updates document values', async () => {
    const get = vi.fn().mockResolvedValue({ values: { hero_title: 'Hello' } })
    const put = vi.fn().mockResolvedValue({ values: { hero_title: 'Hola' } })
    const http = { get, put } as unknown as HttpClient
    const resource = new DocumentValuesResource(http)

    await expect(resource.get('homepage')).resolves.toEqual({ hero_title: 'Hello' })
    await expect(
      resource.update('homepage', { hero_title: 'Hola' }, { locale: 'es' }),
    ).resolves.toEqual({ hero_title: 'Hola' })

    expect(put).toHaveBeenCalledWith('/documents/homepage/values', {
      locale: 'es',
      values: { hero_title: 'Hola' },
    })
  })
})
