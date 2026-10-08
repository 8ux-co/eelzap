import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acceptSessionUrl,
  DRAFT_SESSION_KEY,
  draftExitUrl,
  EDIT_INTENT_KEY,
  inDraftSession,
  leaveDraftSession,
  requestDraftSession,
  takeEditIntent,
} from './draft-session'

/**
 * «Editar» on the live site through a short draft-mode session (ADR 041
 * amendment 2026-10-06; item 13): the exchange's request, the URL the tab is
 * sent to (and every one it refuses to follow), the intent that reopens Editar
 * after the reload, and sign-out, which revokes at Zap and drops the cookie
 * through the site's exit route.
 */

const ZAP = 'https://zap.eel.software'
const ACCESS = 'eel_at_ABCDEFGHIJKL_0123456789'
const ZPT = `zpt_${'A'.repeat(43)}`
const ROUTE = '/api/zap-preview'

let fetchMock: ReturnType<typeof vi.fn>
const ctx = (draftRoute: string | null = ROUTE) => ({ win: window, zapOrigin: ZAP, draftRoute })
const origin = () => window.location.origin
const sessionUrl = (path = '/cafes/huila?x=1#nota') =>
  `${origin()}${ROUTE}#${new URLSearchParams({ token: ZPT, path })}`
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

beforeEach(() => {
  sessionStorage.clear()
  window.history.replaceState(null, '', '/cafes/huila?x=1#nota')
  fetchMock = vi.fn(async () =>
    json(
      {
        url: sessionUrl(),
        path: '/cafes/huila?x=1#nota',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
      201,
    ),
  )
  vi.spyOn(window, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requestDraftSession', () => {
  it('POSTs the draft route and this page’s path with the bearer, no cookies', async () => {
    const result = await requestDraftSession(ctx(), ACCESS)
    expect(result).toMatchObject({ ok: true, url: sessionUrl() })
    if (!result.ok) throw new Error('unreachable')
    const navigation = new URL(result.url)
    expect(navigation.search).toBe('')
    expect(navigation.origin + navigation.pathname + navigation.search).not.toContain('zpt_')
    expect(new URLSearchParams(navigation.hash.slice(1)).get('token')).toBe(ZPT)
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe(`${ZAP}/api/public/v1/preview/session`)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(init.headers).toEqual({
      Authorization: `Bearer ${ACCESS}`,
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      draftRoute: ROUTE,
      path: '/cafes/huila?x=1#nota',
      tokenTransport: 'fragment',
    })
    // Fragments are omitted from HTTP requests; the token is never stored.
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('zpt_')
  })

  it('remembers the intent (this path) and the session until the token expires', async () => {
    const before = Date.now()
    const result = await requestDraftSession(ctx(), ACCESS)
    expect(result.ok).toBe(true)
    expect(JSON.parse(sessionStorage.getItem(EDIT_INTENT_KEY)!)).toMatchObject({
      path: '/cafes/huila',
    })
    const marker = JSON.parse(sessionStorage.getItem(DRAFT_SESSION_KEY)!)
    expect(marker.origin).toBe(origin())
    expect(marker.exp).toBeGreaterThan(before + 9 * 60_000)
    expect(inDraftSession(window)).toBe(true)
  })

  it('a site with no draft route: no-route, no request', async () => {
    expect(await requestDraftSession(ctx(null), ACCESS)).toEqual({ ok: false, reason: 'no-route' })
    expect(await requestDraftSession(ctx('https://evil.example/x'), ACCESS)).toEqual({
      ok: false,
      reason: 'no-route',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, { ok: false, reason: 'expired' }],
    [403, { ok: false, reason: 'failed' }],
    [400, { ok: false, reason: 'failed' }],
    [500, { ok: false, reason: 'failed' }],
  ])('a %s answers %j and remembers nothing', async (status, expected) => {
    fetchMock.mockResolvedValue(json({ error: {} }, status))
    expect(await requestDraftSession(ctx(), ACCESS)).toEqual(expected)
    expect(sessionStorage.getItem(EDIT_INTENT_KEY)).toBeNull()
    expect(inDraftSession(window)).toBe(false)
  })

  it('429 carries Retry-After', async () => {
    fetchMock.mockResolvedValue(json({}, 429, { 'Retry-After': '12' }))
    expect(await requestDraftSession(ctx(), ACCESS)).toEqual({
      ok: false,
      reason: 'rate',
      retryAfter: 12,
    })
  })

  it('a network error (a CORS-less refusal) is refused', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await requestDraftSession(ctx(), ACCESS)).toEqual({ ok: false, reason: 'refused' })
  })

  it('an answer that would send the tab anywhere else is a failure, not a navigation', async () => {
    fetchMock.mockResolvedValue(
      json({ url: `https://evil.example${ROUTE}#token=${ZPT}&path=/` }, 201),
    )
    expect(await requestDraftSession(ctx(), ACCESS)).toEqual({ ok: false, reason: 'failed' })
    expect(sessionStorage.getItem(EDIT_INTENT_KEY)).toBeNull()
  })
})

describe('acceptSessionUrl', () => {
  it('accepts this origin, the announced route, a Zap token and a path', () => {
    expect(acceptSessionUrl(sessionUrl(), window, ROUTE)).toBe(sessionUrl())
  })

  it.each([
    ['another origin', `https://evil.example${ROUTE}#token=${ZPT}&path=/`],
    ['another route', `http://localhost:3000/api/other#token=${ZPT}&path=/`],
    ['no token', `http://localhost:3000${ROUTE}#path=/`],
    ['a token of another shape', `http://localhost:3000${ROUTE}#token=eel_at_x&path=/`],
    ['a protocol-relative path', `http://localhost:3000${ROUTE}#token=${ZPT}&path=//evil.example`],
    ['an absolute path', `http://localhost:3000${ROUTE}#token=${ZPT}&path=https://evil.example`],
    ['legacy query token', `${origin()}${ROUTE}?token=${ZPT}&path=/`],
    ['extra query', `${origin()}${ROUTE}?extra=1#token=${ZPT}&path=/`],
    ['credentials in the URL', sessionUrl().replace('://', '://person:secret@')],
    ['not a URL', 'javascript:alert(1)'],
  ])('refuses %s', (_name, raw) => {
    const url = raw.replace('http://localhost:3000', origin())
    expect(acceptSessionUrl(url, window, ROUTE)).toBeNull()
  })
  it.each([
    '/\\evil.example',
    '/.//evil.example',
    '/a/..//evil.example',
    '/caf\u0000es',
    '/cafes\n/x',
    `/cafes/${ZPT}`,
    `/cafes?token=${ZPT}`,
    `/cafes#${ZPT}`,
    `/cafes/${ZPT.replace('p', '%70')}`,
    `/cafes?token=${ZPT.replace('p', '%70')}`,
    `/cafes#${ZPT.replace('p', '%70')}`,
  ])('refuses an unsafe return path %j in the fragment', (path) => {
    expect(acceptSessionUrl(sessionUrl(path), window, ROUTE)).toBeNull()
  })
})

describe('takeEditIntent', () => {
  it('reopens Editar once, on the same path, soon after', () => {
    sessionStorage.setItem(
      EDIT_INTENT_KEY,
      JSON.stringify({ path: '/cafes/huila', at: Date.now() }),
    )
    expect(takeEditIntent(window)).toBe(true)
    expect(takeEditIntent(window)).toBe(false)
  })

  it('not on another path, and not when stale', () => {
    sessionStorage.setItem(EDIT_INTENT_KEY, JSON.stringify({ path: '/otra', at: Date.now() }))
    expect(takeEditIntent(window)).toBe(false)
    sessionStorage.setItem(
      EDIT_INTENT_KEY,
      JSON.stringify({ path: '/cafes/huila', at: Date.now() - 5 * 60_000 }),
    )
    expect(takeEditIntent(window)).toBe(false)
  })
})

describe('leaveDraftSession (sign-out)', () => {
  let reload: ReturnType<typeof vi.fn>

  beforeEach(() => {
    reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: window.location.origin,
      pathname: '/cafes/huila',
      search: '?x=1',
      hash: '',
      reload,
    } as unknown as Location)
  })

  it('in a draft session: revokes at Zap, drops the cookie through the exit route, reloads', async () => {
    sessionStorage.setItem(
      DRAFT_SESSION_KEY,
      JSON.stringify({ exp: Date.now() + 600_000, origin: window.location.origin }),
    )
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith(ZAP)
        ? new Response(null, { status: 204 })
        : // What `redirect: 'manual'` hands the page for the route's 307.
          ({ type: 'opaqueredirect', ok: false, status: 0 } as Response),
    )
    expect(await leaveDraftSession(ctx(), ACCESS, false)).toBe(true)
    const [revoke, exit] = fetchMock.mock.calls as Array<[string, RequestInit]>
    expect(revoke![0]).toBe(`${ZAP}/api/public/v1/preview/session`)
    expect(revoke![1].method).toBe('DELETE')
    expect(revoke![1].headers).toEqual({ Authorization: `Bearer ${ACCESS}` })
    expect(revoke![1].credentials).toBe('omit')
    expect(exit![0]).toBe(draftExitUrl(window, ROUTE))
    expect(new URL(exit![0]).pathname).toBe(`${ROUTE}/exit`)
    expect(new URL(exit![0]).searchParams.get('path')).toBe('/cafes/huila?x=1')
    expect(exit![1]).toMatchObject({ credentials: 'same-origin', redirect: 'manual' })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(inDraftSession(window)).toBe(false)
  })

  it('a tagged page (draft cookie from elsewhere) is left the same way', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith(ZAP)
        ? new Response(null, { status: 204 })
        : new Response(null, { status: 200 }),
    )
    expect(await leaveDraftSession(ctx(), ACCESS, true)).toBe(true)
    expect(reload).toHaveBeenCalled()
  })

  it('a published page, never in draft mode: nothing to do, no request', async () => {
    expect(await leaveDraftSession(ctx(), ACCESS, false)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('a site without an exit route: no reload (the tokens are revoked anyway)', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith(ZAP)
        ? new Response(null, { status: 204 })
        : new Response('nope', { status: 404 }),
    )
    expect(await leaveDraftSession(ctx(), ACCESS, true)).toBe(false)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' })
    expect(reload).not.toHaveBeenCalled()
  })

  it('never throws, whatever answers', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(leaveDraftSession(ctx(), ACCESS, true)).resolves.toBe(false)
  })
})
