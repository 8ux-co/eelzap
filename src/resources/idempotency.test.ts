import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClient, type EelZapClient } from '../client'
import { EelZapError } from '../errors'
import type { IdempotencyOptions } from '../types/common'

/*
 * Every SDK method whose route deduplicates by `Idempotency-Key` (the API
 * refuses a suite bearer's create without one) sends it on the wire: a fresh
 * `crypto.randomUUID()` per call, or the caller's `idempotencyKey`. Asserted
 * on the request `fetch` receives, not on the resource's call into the HTTP
 * layer, so a header dropped anywhere on the way is caught.
 *
 * In the monorepo, `routes.contract.test.ts` also derives the list of such
 * routes from Zap's route files and checks it against the methods here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Call = (client: EelZapClient, options?: IdempotencyOptions) => Promise<unknown>

/** Each idempotent method, the request it makes, and how to call it. */
const METHODS: ReadonlyArray<{ name: string; route: string; call: Call }> = [
  {
    name: 'collections.create',
    route: 'POST /collections',
    call: (c, o) => c.collections.create({ name: 'Blog', key: 'blog' }, o),
  },
  {
    name: 'collections.fields.create',
    route: 'POST /collections/blog/fields',
    call: (c, o) => c.collections.fields.create('blog', { key: 'title', type: 'TEXT' }, o),
  },
  {
    name: 'collections.sections.create',
    route: 'POST /collections/blog/sections',
    call: (c, o) => c.collections.sections.create('blog', { name: 'Hero' }, o),
  },
  {
    name: 'items.create',
    route: 'POST /collections/blog/items',
    call: (c, o) => c.items.create('blog', { slug: 'hola', values: {} }, o),
  },
  {
    name: 'documents.create',
    route: 'POST /documents',
    call: (c, o) => c.documents.create({ name: 'Home', key: 'homepage' }, o),
  },
  {
    name: 'documents.fields.create',
    route: 'POST /documents/homepage/fields',
    call: (c, o) => c.documents.fields.create('homepage', { key: 'title', type: 'TEXT' }, o),
  },
  {
    name: 'documents.sections.create',
    route: 'POST /documents/homepage/sections',
    call: (c, o) => c.documents.sections.create('homepage', { name: 'Hero' }, o),
  },
  {
    name: 'media.fromUrl',
    route: 'POST /media/from-url',
    call: (c, o) => c.media.fromUrl({ url: 'https://example.com/a.png' }, o),
  },
  {
    name: 'comments.create',
    route: 'POST /comments',
    call: (c, o) => c.comments.create({ document: 'homepage', body: 'Hola' }, o),
  },
  {
    name: 'comments.reply',
    route: 'POST /comments/t1/replies',
    call: (c, o) => c.comments.reply('t1', { body: 'Listo' }, o),
  },
  {
    name: 'comments.saveToDraft',
    route: 'POST /comments/save-to-draft',
    call: (c, o) =>
      c.comments.saveToDraft(
        { document: 'homepage', body: 'Typo', proposedValues: [{ fieldKey: 'title', value: 'H' }] },
        o,
      ),
  },
]

interface Sent {
  route: string
  key: string | null
}

function recordingClient(respond: () => Response = () => Response.json({})) {
  const sent: Sent[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    sent.push({
      route: `${init?.method ?? 'GET'} ${url.pathname.replace(/^\/api\/public\/v1/, '')}`,
      key: new Headers(init?.headers).get('Idempotency-Key'),
    })
    return respond()
  })
  const client = createClient({
    apiKey: 'secret_test',
    baseUrl: 'https://zap.test',
    pathPrefix: '/api/public/v1',
    fetch,
  })
  return { client, sent }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(METHODS)('$name sends an Idempotency-Key', ({ route, call }) => {
  it('on its request, as a random UUID', async () => {
    const { client, sent } = recordingClient()
    await call(client)

    expect(sent).toHaveLength(1)
    expect(sent[0]!.route).toBe(route)
    expect(sent[0]!.key).toMatch(UUID)
  })

  it('made by globalThis.crypto.randomUUID', async () => {
    const randomUUID = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-00000000c0de')
    const { client, sent } = recordingClient()
    await call(client)

    expect(randomUUID).toHaveBeenCalledTimes(1)
    expect(sent[0]!.key).toBe('00000000-0000-4000-8000-00000000c0de')
  })

  it('unique per call', async () => {
    const { client, sent } = recordingClient()
    await call(client)
    await call(client)
    await call(client)

    const keys = sent.map((request) => request.key)
    expect(keys.every((key) => key !== null && UUID.test(key))).toBe(true)
    expect(new Set(keys).size).toBe(3)
  })

  it('the caller’s own key when given, the same on the caller’s retry', async () => {
    const { client, sent } = recordingClient()
    await call(client, { idempotencyKey: 'order-42-create' })
    await call(client, { idempotencyKey: 'order-42-create' })

    expect(sent.map((request) => request.key)).toEqual(['order-42-create', 'order-42-create'])
  })

  it('one request per call: no hidden retry that could send a second key', async () => {
    // The SDK does not retry on its own. A failure surfaces after exactly one
    // request, so the only retry is the caller's, made safe by passing the
    // same `idempotencyKey` (above).
    const { client, sent } = recordingClient(() =>
      Response.json({ error: { code: 'INTERNAL_ERROR', message: 'down' } }, { status: 503 }),
    )
    await expect(call(client)).rejects.toBeInstanceOf(EelZapError)

    expect(sent).toHaveLength(1)
    expect(sent[0]!.key).toMatch(UUID)
  })
})

describe('non-idempotent writes', () => {
  it('send no Idempotency-Key (the API ignores it there; the header is not noise)', async () => {
    const { client, sent } = recordingClient()
    await client.collections.update('blog', { name: 'Blog' })
    await client.items.update('blog', 'hola', { values: {} })
    await client.documents.fields.update('homepage', 'f1', { label: 'Title' })

    expect(sent.map((request) => request.key)).toEqual([null, null, null])
  })
})
