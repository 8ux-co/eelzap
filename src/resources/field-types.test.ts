import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { createClient } from '../client'
import type {
  CreateDocumentFieldInput,
  CreateFieldInput,
  DocumentListEntry,
  CollectionDetail,
  CollectionSummary,
  FieldInfo,
  FieldType,
} from '../index'
import type * as Sdk from '../index'

/*
 * The field types the SDK lets you write are exactly the ones Zap's field
 * routes accept (`FIELD_TYPES` in apps/zap; the monorepo's
 * `routes.contract.test.ts` binds the two), and the delivery schema reads
 * publish the same names. `SHORT_TEXT` is a legacy name Zap no longer uses
 * anywhere: writing it is a 400, so it does not typecheck as a field type.
 *
 * The type assertions are checked by `tsc` (`pnpm typecheck`), not at runtime.
 */

type ApiFieldType =
  | 'TEXT'
  | 'LONG_TEXT'
  | 'RICH_TEXT'
  | 'NUMBER'
  | 'INTEGER'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'CURRENCY'
  | 'ENUM'
  | 'GALLERY'
  | 'IMAGE'
  | 'VIDEO'
  | 'FILE'
  | 'URL'
  | 'EMAIL'

describe('field types', () => {
  it('FieldType is exactly the API’s, for writes and the field routes’ answers', () => {
    expectTypeOf<FieldType>().toEqualTypeOf<ApiFieldType>()
    expectTypeOf<CreateFieldInput['type']>().toEqualTypeOf<ApiFieldType>()
    expectTypeOf<CreateDocumentFieldInput['type']>().toEqualTypeOf<ApiFieldType>()
    expectTypeOf<FieldInfo['type']>().toEqualTypeOf<ApiFieldType>()

    // @ts-expect-error SHORT_TEXT is not a type the field routes accept.
    const legacy: CreateFieldInput = { key: 'title', type: 'SHORT_TEXT' }
    expect(legacy.type).toBe('SHORT_TEXT')
  })

  it('the delivery schema reads use the same FieldType — no delivery-only name', () => {
    expectTypeOf<CollectionSummary['fields']>().toEqualTypeOf<FieldInfo[] | undefined>()
    expectTypeOf<CollectionDetail['fields']>().toEqualTypeOf<FieldInfo[]>()
    expectTypeOf<DocumentListEntry['fields']>().toEqualTypeOf<FieldInfo[]>()
    expectTypeOf<CollectionDetail['fields'][number]['type']>().toEqualTypeOf<ApiFieldType>()

    // The delivery-only types are gone: delivery publishes TEXT as TEXT.
    // @ts-expect-error DeliveryFieldType no longer exists.
    type _NoDeliveryFieldType = Sdk.DeliveryFieldType
    // @ts-expect-error DeliveryFieldInfo no longer exists.
    type _NoDeliveryFieldInfo = Sdk.DeliveryFieldInfo
  })

  it('a TEXT field create sends `type: "TEXT"` on the wire, collection and document', async () => {
    const bodies: unknown[] = []
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ field: { id: 'f1', key: 'title', type: 'TEXT' } }, { status: 201 })
    })
    const client = createClient({ apiKey: 'secret_test', baseUrl: 'https://zap.test', fetch })

    const field = await client.collections.fields.create('blog', {
      key: 'title',
      label: 'Title',
      type: 'TEXT',
    })
    await client.documents.fields.create('homepage', { key: 'title', label: 'Title', type: 'TEXT' })

    expect(bodies).toEqual([
      { key: 'title', label: 'Title', type: 'TEXT' },
      { key: 'title', label: 'Title', type: 'TEXT' },
    ])
    expect(field.type).toBe('TEXT')
  })
})
