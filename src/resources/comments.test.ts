import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { createClient } from '../client'
import type {
  CommentDraftAnswer,
  CommentListResponse,
  CommentReplyAnswer,
  CommentThreadAnswer,
  CreateCommentInput,
  OnPageComments,
} from '../types/comments'

const KEY = 'eel_sk_test'

function client(answer: unknown, status = 200) {
  const fetch = vi.fn(async () => Response.json(answer, { status }))
  const sdk = createClient({
    apiKey: KEY,
    baseUrl: 'https://zap.test',
    pathPrefix: '/api/public/v1',
    defaultHeaders: { 'X-Eel-Site': 'verdeorigen' },
    fetch,
  })
  const sent = () =>
    fetch.mock.calls.map((call) => {
      const [url, init] = call as unknown as [string, RequestInit]
      return {
        method: init.method,
        url: new URL(url),
        headers: new Headers(init.headers),
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      }
    })
  return { sdk, sent }
}

const THREAD = { thread: { id: 't1', status: 'OPEN' }, comments: [] }

describe('CommentsResource', () => {
  it('lists with exactly the filters given, booleans as true/false', async () => {
    const answer = {
      items: [],
      counts: { OPEN: 0, RESOLVED: 0 },
      page: 1,
      pageSize: 50,
      total: 0,
      hasMore: false,
    }
    const { sdk, sent } = client(answer)

    const result = await sdk.comments.list({
      collection: 'blog',
      slug: 'hello-world',
      isChangeRequest: false,
      status: 'OPEN',
      assignee: 'me',
      pageSize: 20,
    })

    expectTypeOf(result).toEqualTypeOf<CommentListResponse>()
    expect(result).toEqual(answer)
    const [call] = sent()
    expect(call!.method).toBe('GET')
    expect(call!.url.pathname).toBe('/api/public/v1/comments')
    expect(Object.fromEntries(call!.url.searchParams)).toEqual({
      collection: 'blog',
      slug: 'hello-world',
      isChangeRequest: 'false',
      status: 'OPEN',
      assignee: 'me',
      pageSize: '20',
    })
    expect(call!.headers.get('Authorization')).toBe(`Bearer ${KEY}`)
    expect(call!.headers.get('X-Eel-Site')).toBe('verdeorigen')
  })

  it('never forwards a key the strict list query would refuse', async () => {
    const { sdk, sent } = client({})
    await sdk.comments.list({ document: 'homepage', stray: 'x' } as never)
    expect(sent()[0]!.url.search).toBe('?document=homepage')
    await sdk.comments.list()
    expect(sent()[1]!.url.search).toBe('')
  })

  it('creates with an Idempotency-Key, the caller’s when given, and the body as sent', async () => {
    const { sdk, sent } = client(THREAD, 201)
    const input: CreateCommentInput = {
      collection: 'blog',
      slug: 'hello-world',
      isChangeRequest: true,
      pageUrl: 'https://example.com/blog/hello-world',
      anchors: [{ field: { key: 'title' } }, { spot: { x: 0.5, y: 0.25 } }],
      body: 'Shorter title?',
      proposedValues: [{ fieldKey: 'title', value: 'Hello' }],
    }

    const result = await sdk.comments.create(input, { idempotencyKey: 'idem-1' })
    await sdk.comments.create(input)

    expectTypeOf(result).toEqualTypeOf<CommentThreadAnswer>()
    expect(result).toEqual(THREAD)
    const [first, second] = sent()
    expect(first!.method).toBe('POST')
    expect(first!.url.pathname).toBe('/api/public/v1/comments')
    expect(first!.body).toEqual(input)
    expect(first!.headers.get('Idempotency-Key')).toBe('idem-1')
    expect(second!.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(second!.headers.get('Idempotency-Key')).not.toBe('idem-1')
  })

  it('types a record as an entry or a document, never both', () => {
    expectTypeOf<{ document: string; body: string }>().toExtend<CreateCommentInput>()
    expectTypeOf<{
      collection: string
      slug: string
      body: string
    }>().toExtend<CreateCommentInput>()
    expectTypeOf<{
      collection: string
      slug: string
      document: string
      body: string
    }>().not.toExtend<CreateCommentInput>()
    expectTypeOf<{ collection: string; body: string }>().not.toExtend<CreateCommentInput>()
  })

  it('gets and updates one thread by id', async () => {
    const { sdk, sent } = client(THREAD)

    await sdk.comments.get('t1')
    const updated = await sdk.comments.update('t1', { status: 'RESOLVED', resolution: 'DISMISSED' })

    expectTypeOf(updated).toEqualTypeOf<CommentThreadAnswer>()
    const [get, patch] = sent()
    expect(get!.method).toBe('GET')
    expect(get!.url.pathname).toBe('/api/public/v1/comments/t1')
    expect(patch!.method).toBe('PATCH')
    expect(patch!.url.pathname).toBe('/api/public/v1/comments/t1')
    expect(patch!.body).toEqual({ status: 'RESOLVED', resolution: 'DISMISSED' })
    expect(patch!.headers.has('Idempotency-Key')).toBe(false)
  })

  it('replies idempotently, and applies without a key', async () => {
    const { sdk, sent } = client({ comment: { id: 'c2' }, thread: { id: 't1', status: 'OPEN' } })

    const reply = await sdk.comments.reply('t1', { body: 'Done' }, { idempotencyKey: 'idem-2' })
    await sdk.comments.apply('t1')

    expectTypeOf(reply).toEqualTypeOf<CommentReplyAnswer>()
    const [post, apply] = sent()
    expect(post!.url.pathname).toBe('/api/public/v1/comments/t1/replies')
    expect(post!.body).toEqual({ body: 'Done' })
    expect(post!.headers.get('Idempotency-Key')).toBe('idem-2')
    expect(apply!.method).toBe('POST')
    expect(apply!.url.pathname).toBe('/api/public/v1/comments/t1/apply')
    expect(apply!.body).toBeUndefined()
    expect(apply!.headers.has('Idempotency-Key')).toBe(false)
  })

  it('saves to the draft idempotently', async () => {
    const answer = { ...THREAD, draftVersionId: 'v3' }
    const { sdk, sent } = client(answer, 201)

    const result = await sdk.comments.saveToDraft({
      document: 'homepage',
      body: 'Typo',
      proposedValues: [{ fieldKey: 'title', locale: 'es', value: 'Hola' }],
    })

    expectTypeOf(result).toEqualTypeOf<CommentDraftAnswer>()
    expect(result.draftVersionId).toBe('v3')
    const [call] = sent()
    expect(call!.url.pathname).toBe('/api/public/v1/comments/save-to-draft')
    expect(call!.body).toEqual({
      document: 'homepage',
      body: 'Typo',
      proposedValues: [{ fieldKey: 'title', locale: 'es', value: 'Hola' }],
    })
    expect(call!.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('reads the page’s threads with the refs comma separated, none when empty', async () => {
    const answer = {
      viewer: { name: 'Ana' },
      liveEditing: true,
      fields: {},
      comments: [],
      truncated: false,
    }
    const { sdk, sent } = client(answer)

    const result = await sdk.comments.onPage('https://example.com/blog?x=1', [
      'blog/hello-world',
      'doc:homepage',
    ])
    await sdk.comments.onPage('https://example.com/')

    expectTypeOf(result).toEqualTypeOf<OnPageComments>()
    const [withRefs, without] = sent()
    expect(withRefs!.url.pathname).toBe('/api/public/v1/comments/on-page')
    expect(Object.fromEntries(withRefs!.url.searchParams)).toEqual({
      url: 'https://example.com/blog?x=1',
      refs: 'blog/hello-world,doc:homepage',
    })
    expect(Object.fromEntries(without!.url.searchParams)).toEqual({ url: 'https://example.com/' })
  })

  it('rejects with the route’s error envelope', async () => {
    const { sdk } = client(
      { error: { code: 'HAS_PROPOSAL', message: 'has proposed values', status: 409 } },
      409,
    )
    await expect(sdk.comments.update('t1', { isChangeRequest: false })).rejects.toMatchObject({
      code: 'HAS_PROPOSAL',
      status: 409,
    })
  })
})
