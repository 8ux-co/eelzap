import { describe, expect, it } from 'vitest'

import { normalizeFieldInput, toDeleteBody } from './resource-helpers'

describe('resource helpers', () => {
  it('normalizes field names into labels only when needed', () => {
    expect(normalizeFieldInput({ name: 'Title', key: 'title', type: 'TEXT' })).toEqual({
      name: 'Title',
      key: 'title',
      type: 'TEXT',
      label: 'Title',
    })
    expect(normalizeFieldInput({ label: 'Title', key: 'title', type: 'TEXT' })).toEqual({
      label: 'Title',
      key: 'title',
      type: 'TEXT',
    })
  })

  it('creates delete bodies only when media ids are provided', () => {
    expect(toDeleteBody()).toBeUndefined()
    expect(toDeleteBody({ deleteMediaIds: [] })).toBeUndefined()
    expect(toDeleteBody({ deleteMediaIds: ['media_1'] })).toEqual({
      deleteMediaIds: ['media_1'],
    })
  })
})
