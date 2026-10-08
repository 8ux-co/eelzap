// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetPreviewTokenCacheForTests,
  createDraftModeExitRoute,
  createDraftModeRoute,
  DEFAULT_ZAP_ORIGIN,
  getPreviewToken,
  getValidPreviewToken,
  NEXT_DRAFT_COOKIE,
  PREVIEW_TOKEN_COOKIE,
  safeRedirectPath,
  SITE_API_KEY_HEADER,
  TOKEN_VALIDATION_PATH,
  DEFAULT_DRAFT_ROUTE,
  isZapPreview,
  ZapPreview,
} from './next'

/**
 * The draft-mode route (zap-cms-v2 §2.5, §3.5): a valid token for THIS site
 * enables draft mode, sets the cookies a third-party frame keeps, and
 * redirects to the path without the token; everything else is refused with
 * nothing enabled. Every refusal is attempted.
 */

const TOKEN = `zpt_${'A'.repeat(43)}`
const SITE = 'https://verdeorigen.co'

const SITE_API_KEY = 'zap_sk_verdeorigen'

function setup(
  answer: { status?: number; siteKey?: string | null; code?: string; throws?: boolean } = {},
) {
  const enable = vi.fn()
  const draftMode = vi.fn(async () => ({ enable }))
  const cookies = vi.fn(async () => ({
    get: (name: string) => (name === NEXT_DRAFT_COOKIE ? { value: 'bypass-123' } : undefined),
  }))
  const fetchMock = vi.fn(async () => {
    if (answer.throws) throw new TypeError('fetch failed')
    const status = answer.status ?? 200
    const body =
      status === 200
        ? { site: answer.siteKey === null ? {} : { key: answer.siteKey ?? 'verdeorigen' } }
        : { error: { code: answer.code ?? 'UNAUTHORIZED' } }
    return Response.json(body, { status })
  })
  const GET = createDraftModeRoute({
    siteKey: 'verdeorigen',
    apiKey: SITE_API_KEY,
    draftMode,
    cookies,
    fetch: fetchMock as unknown as typeof fetch,
  })
  const call = (query: string) => GET(new Request(`${SITE}/api/zap-preview?${query}`))
  const post = (
    body: BodyInit,
    url = `${SITE}/api/zap-preview`,
    headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' },
  ) => GET(new Request(url, { method: 'POST', headers, body }))
  return { call, post, enable, fetchMock }
}

const query = (token: string, path?: string) =>
  `token=${encodeURIComponent(token)}${path === undefined ? '' : `&path=${encodeURIComponent(path)}`}`

describe('createDraftModeRoute: a valid token for this site', () => {
  it('validates with Zap, enables draft mode and redirects to the path without the token', async () => {
    const { call, enable, fetchMock } = setup()
    const response = await call(query(TOKEN, '/blog/hola?ref=zap'))
    expect(response.status).toBe(307)
    expect(response.headers.get('deprecation')).toBeNull()
    expect(response.headers.get('location')).toBe('/blog/hola?ref=zap')
    expect(response.headers.get('location')).not.toContain('zpt_')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(enable).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_ZAP_ORIGIN}${TOKEN_VALIDATION_PATH}`)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    // The site's own key goes with it: Zap binds the token to THAT site.
    expect((init.headers as Record<string, string>)[SITE_API_KEY_HEADER]).toBe(SITE_API_KEY)
    expect(init.cache).toBe('no-store')
  })

  it('sets both cookies SameSite=None; Secure; Partitioned; HttpOnly', async () => {
    const { call } = setup()
    const response = await call(query(TOKEN, '/'))
    const cookies = response.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    const token = cookies.find((c) => c.startsWith(`${PREVIEW_TOKEN_COOKIE}=`))!
    const bypass = cookies.find((c) => c.startsWith(`${NEXT_DRAFT_COOKIE}=`))!
    expect(token).toContain(`${PREVIEW_TOKEN_COOKIE}=${TOKEN}`)
    expect(token).toContain('Max-Age=600')
    expect(bypass).toContain(`${NEXT_DRAFT_COOKIE}=bypass-123`)
    // Draft mode ends with the token, not with the browser session.
    expect(bypass).toContain('Max-Age=600')
    for (const cookie of [token, bypass]) {
      for (const attribute of ['SameSite=None', 'Secure', 'Partitioned', 'HttpOnly', 'Path=/']) {
        expect(cookie).toContain(attribute)
      }
    }
  })

  it('defaults the path to the home page', async () => {
    const { call } = setup()
    const response = await call(query(TOKEN))
    expect(response.headers.get('location')).toBe('/')
  })
})

describe('createDraftModeRoute: refusals enable nothing', () => {
  it.each([
    ['a malformed token', 'token=zpt_short'],
    ['a site key instead', 'token=secret_abc'],
  ])('%s → 401 without asking Zap', async (_name, q) => {
    const { call, enable, fetchMock } = setup()
    const response = await call(q)
    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(enable).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it.each([
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example/',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/%0d%0aSet-Cookie:x=y',
    'blog/hola',
    `/blog?token=${TOKEN}`,
    '/blog\nx',
    // Dot segments that collapse into a protocol-relative `//host`.
    '/.//evil.example/',
    '/a/..//evil.example/',
    '/%2e//evil.example/',
    '/..//evil.example',
  ])('an open-redirect attempt in path: %s → 400', async (path) => {
    const { call, enable, fetchMock } = setup()
    const response = await call(query(TOKEN, path))
    if (path === '/%0d%0aSet-Cookie:x=y') {
      // Percent-encoded stays encoded: a path on this site, never a header.
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('/%0d%0aSet-Cookie:x=y')
      return
    }
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_path' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(enable).not.toHaveBeenCalled()
  })

  it('an unknown, expired or revoked token (Zap says 401) → 401', async () => {
    const { call, enable } = setup({ status: 401 })
    const response = await call(query(TOKEN, '/'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'token_refused' })
    expect(enable).not.toHaveBeenCalled()
  })

  it("a token minted for another Zap site → 403, so nobody's own token opens yours", async () => {
    const { call, enable } = setup({ siteKey: 'otro-sitio' })
    const response = await call(query(TOKEN, '/'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'wrong_site' })
    expect(enable).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('a token Zap says was minted for another site than our key (WRONG_SITE) → 403', async () => {
    // A same-named site in another workspace answers with OUR site key; only
    // Zap's binding to the API key can tell, and the route must honour it.
    const { call, enable } = setup({ status: 403, code: 'WRONG_SITE' })
    const response = await call(query(TOKEN, '/'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'wrong_site' })
    expect(enable).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('refuses to build without the site API key', () => {
    expect(() =>
      createDraftModeRoute({
        siteKey: 'verdeorigen',
        apiKey: '',
        draftMode: async () => ({ enable() {} }),
      }),
    ).toThrow(/apiKey/)
  })

  it('Zap unreachable or answering garbage → 502', async () => {
    for (const answer of [{ throws: true }, { status: 503 }, { siteKey: null }]) {
      const { call, enable } = setup(answer)
      const response = await call(query(TOKEN, '/'))
      expect(response.status).toBe(502)
      expect(enable).not.toHaveBeenCalled()
    }
  })
})

describe('createDraftModeRoute: POST exchange', () => {
  it.each([
    {},
    { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' },
    { 'Sec-Fetch-Site': 'same-site' },
    { Origin: 'null' },
    { Origin: `${SITE}.evil.example` },
    { Origin: `${SITE}/` },
  ] as Array<Record<string, string>>)(
    'refuses POST without same-origin evidence: %j',
    async (headers) => {
      const { post, enable, fetchMock } = setup()
      const response = await post(
        new URLSearchParams({ token: TOKEN, path: '/' }),
        undefined,
        headers,
      )
      expect(response.status).toBe(403)
      expect(response.headers.getSetCookie()).toEqual([])
      expect(enable).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    { 'Sec-Fetch-Site': 'same-origin' },
    { Origin: SITE },
    { 'Sec-Fetch-Site': 'same-site', Origin: SITE },
  ] as Array<Record<string, string>>)(
    'allows POST with same-origin evidence: %j',
    async (headers) => {
      const { post, enable } = setup()
      const response = await post(
        new URLSearchParams({ token: TOKEN, path: '/' }),
        undefined,
        headers,
      )
      expect(response.status).toBe(303)
      expect(response.headers.getSetCookie()).toHaveLength(2)
      expect(enable).toHaveBeenCalledTimes(1)
    },
  )

  it('reads only the body, validates with Zap and redirects with 303 so the token body is not replayed', async () => {
    const { post, enable, fetchMock } = setup()
    const response = await post(new URLSearchParams({ token: TOKEN, path: '/blog?ref=zap#note' }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/blog?ref=zap#note')
    expect(response.headers.get('location')).not.toContain(TOKEN)
    expect(response.headers.get('deprecation')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(enable).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain(TOKEN)
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      [SITE_API_KEY_HEADER]: SITE_API_KEY,
    })
    expect(response.headers.getSetCookie()).toHaveLength(2)
    expect(response.headers.getSetCookie()[0]).toContain(`${PREVIEW_TOKEN_COOKIE}=${TOKEN}`)
  })

  it('defaults the body path to / and never falls back to query credentials', async () => {
    const { post, enable } = setup()
    expect((await post(new URLSearchParams({ token: TOKEN }))).headers.get('location')).toBe('/')
    enable.mockClear()
    const response = await post(
      new URLSearchParams(),
      `${SITE}/api/zap-preview?${query(TOKEN, '/')}`,
    )
    expect(response.status).toBe(401)
    expect(enable).not.toHaveBeenCalled()
  })

  it.each([
    '//evil.example',
    'https://evil.example',
    '/\\evil.example',
    '/.//evil.example',
    '/a/..//evil.example',
    '/%2e//evil.example',
    '/blog\nnext',
    `/blog?token=${TOKEN}`,
    `/blog#${TOKEN}`,
    `/${TOKEN}`,
    `/blog?t=${TOKEN.replace('zpt_', 'z%70t_')}`,
    `/blog?t=${TOKEN.replace('zpt_', '%257Apt_')}`,
  ])('refuses unsafe or token-bearing body path %s before validation', async (path) => {
    const { post, enable, fetchMock } = setup()
    const response = await post(new URLSearchParams({ token: TOKEN, path }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_path' })
    expect(response.headers.get('location')).toBeNull()
    expect(enable).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([new URLSearchParams(), new URLSearchParams({ token: 'zpt_short' }), 'not a form'])(
    'refuses malformed bodies without enabling drafts',
    async (body) => {
      const { post, enable, fetchMock } = setup()
      expect((await post(body)).status).toBe(401)
      expect(enable).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    [{ status: 401 }, 401],
    [{ siteKey: 'another-site' }, 403],
    [{ status: 403, code: 'WRONG_SITE' }, 403],
    [{ throws: true }, 502],
  ] as const)('still enforces token/site validation for POST: %j', async (answer, status) => {
    const { post, enable } = setup(answer)
    const response = await post(new URLSearchParams({ token: TOKEN, path: '/' }))
    expect(response.status).toBe(status)
    expect(response.headers.getSetCookie()).toEqual([])
    expect(enable).not.toHaveBeenCalled()
  })
})

describe('safeRedirectPath', () => {
  it('keeps a same-site path with its query and hash', () => {
    expect(safeRedirectPath('/a/b?c=1#d', SITE)).toBe('/a/b?c=1#d')
    expect(safeRedirectPath(null, SITE)).toBe('/')
  })
})

describe('getPreviewToken', () => {
  it('reads the header first, then the cookie, and only a well-formed token', () => {
    const fromHeader = new Request(SITE, { headers: { 'x-zap-preview-token': TOKEN } })
    expect(getPreviewToken(fromHeader)).toBe(TOKEN)
    const fromCookie = new Request(SITE, {
      headers: { cookie: `a=1; ${PREVIEW_TOKEN_COOKIE}=${TOKEN}` },
    })
    expect(getPreviewToken(fromCookie)).toBe(TOKEN)
    const bad = new Request(SITE, {
      headers: { 'x-zap-preview-token': 'zpt_bad', cookie: `${PREVIEW_TOKEN_COOKIE}=secret_x` },
    })
    expect(getPreviewToken(bad)).toBeNull()
    expect(
      getPreviewToken({
        headers: { get: () => null },
        cookies: { get: () => ({ value: TOKEN }) },
      }),
    ).toBe(TOKEN)
  })
})

describe('createDraftModeExitRoute', () => {
  function exitSetup() {
    const disable = vi.fn()
    const draftMode = vi.fn(async () => ({ disable }))
    const GET = createDraftModeExitRoute({ draftMode })
    const call = (query = '') => GET(new Request(`${SITE}/api/zap-preview/exit${query}`))
    return { call, disable }
  }

  it('disables draft mode and expires both cookies with the attributes they were set with', async () => {
    const { call, disable } = exitSetup()
    const response = await call('?path=%2Fblog%2Fhola%3Fa%3D1')
    expect(disable).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/blog/hola?a=1')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const cookies = response.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    for (const name of [NEXT_DRAFT_COOKIE, PREVIEW_TOKEN_COOKIE]) {
      const cookie = cookies.find((c) => c.startsWith(`${name}=`))!
      expect(cookie, name).toBeDefined()
      expect(cookie.startsWith(`${name}=;`)).toBe(true)
      expect(cookie).toContain('Max-Age=0')
      for (const attribute of ['SameSite=None', 'Secure', 'Partitioned', 'HttpOnly', 'Path=/']) {
        expect(cookie, `${name} ${attribute}`).toContain(attribute)
      }
    }
  })

  it('defaults to the home page', async () => {
    const { call } = exitSetup()
    expect((await call()).headers.get('location')).toBe('/')
  })

  it.each(['//evil.com', '/.//host', 'https://x', '/\\evil.com', `/a?t=${TOKEN}`])(
    'an unsafe path %s falls back to /, still exiting',
    async (path) => {
      const { call, disable } = exitSetup()
      const response = await call(`?path=${encodeURIComponent(path)}`)
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('/')
      expect(disable).toHaveBeenCalledTimes(1)
      expect(response.headers.getSetCookie()).toHaveLength(2)
    },
  )
})

describe('getValidPreviewToken', () => {
  const OPTIONS = { siteKey: 'verdeorigen', apiKey: SITE_API_KEY }
  const request = (token: string = TOKEN) =>
    new Request(SITE, { headers: { 'x-zap-preview-token': token } })

  function zap(answer: {
    status?: number
    siteKey?: string
    code?: string
    expiresAt?: string
    throws?: boolean
  }) {
    return vi.fn(async (_url: string, _init?: RequestInit) => {
      if (answer.throws) throw new TypeError('fetch failed')
      const status = answer.status ?? 200
      const body =
        status === 200
          ? {
              site: { key: answer.siteKey ?? 'verdeorigen' },
              ...(answer.expiresAt ? { expiresAt: answer.expiresAt } : {}),
            }
          : { error: { code: answer.code ?? 'UNAUTHORIZED' } }
      return Response.json(body, { status })
    })
  }
  const withFetch = (f: ReturnType<typeof zap>, extra: Partial<typeof OPTIONS> = {}) => ({
    ...OPTIONS,
    ...extra,
    fetch: f as unknown as typeof fetch,
  })

  beforeEach(() => {
    __resetPreviewTokenCacheForTests()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a token Zap confirms for this site → the token, asked exactly as the draft-mode route asks', async () => {
    const f = zap({})
    expect(await getValidPreviewToken(request(), withFetch(f))).toBe(TOKEN)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${DEFAULT_ZAP_ORIGIN}${TOKEN_VALIDATION_PATH}`)
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(headers[SITE_API_KEY_HEADER]).toBe(SITE_API_KEY)
  })

  it('reads the cookie too', async () => {
    const f = zap({})
    const fromCookie = { cookies: { get: () => ({ value: TOKEN }) } }
    expect(await getValidPreviewToken(fromCookie, withFetch(f))).toBe(TOKEN)
  })

  it('an unknown or revoked token (Zap says 401) → null', async () => {
    expect(await getValidPreviewToken(request(), withFetch(zap({ status: 401 })))).toBeNull()
  })

  it('an expired token (Zap says 401 KEY_EXPIRED) → null', async () => {
    const f = zap({ status: 401, code: 'KEY_EXPIRED' })
    expect(await getValidPreviewToken(request(), withFetch(f))).toBeNull()
  })

  it('a token Zap binds to another site (403 WRONG_SITE) → null', async () => {
    const f = zap({ status: 403, code: 'WRONG_SITE' })
    expect(await getValidPreviewToken(request(), withFetch(f))).toBeNull()
  })

  it('a 200 naming another site key → null', async () => {
    const f = zap({ siteKey: 'otro-sitio' })
    expect(await getValidPreviewToken(request(), withFetch(f))).toBeNull()
  })

  it('an expiry already past in the answer → null', async () => {
    const f = zap({ expiresAt: '2026-10-04T11:59:59Z' })
    expect(await getValidPreviewToken(request(), withFetch(f))).toBeNull()
  })

  it('a malformed token never asks Zap', async () => {
    const f = zap({})
    for (const token of ['zpt_short', 'secret_abc', '']) {
      expect(await getValidPreviewToken(request(token), withFetch(f))).toBeNull()
    }
    expect(await getValidPreviewToken({}, withFetch(f))).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('Zap unreachable or failing → null, and asked again next time', async () => {
    for (const answer of [{ throws: true }, { status: 503 }]) {
      __resetPreviewTokenCacheForTests()
      const f = zap(answer)
      expect(await getValidPreviewToken(request(), withFetch(f))).toBeNull()
      expect(await getValidPreviewToken(request(), withFetch(f))).toBeNull()
      expect(f).toHaveBeenCalledTimes(2)
    }
  })

  it('caches a confirmed token: two calls within the TTL ask Zap once, then it asks again', async () => {
    const f = zap({})
    expect(await getValidPreviewToken(request(), withFetch(f))).toBe(TOKEN)
    vi.advanceTimersByTime(59_000)
    expect(await getValidPreviewToken(request(), withFetch(f))).toBe(TOKEN)
    expect(f).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2_000)
    expect(await getValidPreviewToken(request(), withFetch(f))).toBe(TOKEN)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('a confirmed entry does not outlive the expiry Zap answers', async () => {
    const valid = zap({ expiresAt: '2026-10-04T12:00:20Z' })
    expect(await getValidPreviewToken(request(), withFetch(valid))).toBe(TOKEN)
    vi.advanceTimersByTime(19_000)
    expect(await getValidPreviewToken(request(), withFetch(valid))).toBe(TOKEN)
    expect(valid).toHaveBeenCalledTimes(1)
    // Past the expiry Zap now refuses it; the cache must not answer for Zap.
    vi.advanceTimersByTime(2_000)
    const expired = zap({ status: 401, code: 'KEY_EXPIRED' })
    expect(await getValidPreviewToken(request(), withFetch(expired))).toBeNull()
    expect(expired).toHaveBeenCalledTimes(1)
  })

  it('a refused token is cached for the shorter TTL, then asked again', async () => {
    const refused = zap({ status: 401 })
    expect(await getValidPreviewToken(request(), withFetch(refused))).toBeNull()
    vi.advanceTimersByTime(9_000)
    expect(await getValidPreviewToken(request(), withFetch(refused))).toBeNull()
    expect(refused).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2_000)
    const nowValid = zap({})
    expect(await getValidPreviewToken(request(), withFetch(nowValid))).toBe(TOKEN)
    expect(nowValid).toHaveBeenCalledTimes(1)
  })

  it("a token confirmed for one site is not served from cache to another site's check", async () => {
    const forUs = zap({})
    expect(await getValidPreviewToken(request(), withFetch(forUs))).toBe(TOKEN)
    const forOther = zap({ status: 403, code: 'WRONG_SITE' })
    const other = withFetch(forOther, { siteKey: 'otro-sitio', apiKey: 'zap_sk_otro' })
    expect(await getValidPreviewToken(request(), other)).toBeNull()
    expect(forOther).toHaveBeenCalledTimes(1)
  })

  it('never logs the token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    await getValidPreviewToken(request(), withFetch(zap({ throws: true })))
    await getValidPreviewToken(request(), withFetch(zap({ status: 401 })))
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN)
      spy.mockRestore()
    }
  })

  it('refuses to run without siteKey or apiKey', async () => {
    await expect(
      getValidPreviewToken(request(), { siteKey: 'verdeorigen', apiKey: '' }),
    ).rejects.toThrow(/apiKey/)
    await expect(getValidPreviewToken(request(), { siteKey: '', apiKey: 'k' })).rejects.toThrow(
      /siteKey/,
    )
  })
})

describe('isZapPreview and the boot component (zap-cms-v2 §2.7)', () => {
  const TOKEN_OK = `zpt_${'B'.repeat(43)}`

  it('isZapPreview is a shape hint: a well-formed token in the header or the cookie', () => {
    const req = (headers: Record<string, string>) =>
      new Request('https://site.example/x', { headers })
    expect(isZapPreview(req({ 'x-zap-preview-token': TOKEN_OK }))).toBe(true)
    expect(isZapPreview(req({ cookie: `a=b; __zap_preview=${TOKEN_OK}` }))).toBe(true)
    expect(isZapPreview(req({ 'x-zap-preview-token': 'zpt_short' }))).toBe(false)
    expect(isZapPreview(req({}))).toBe(false)
    expect(isZapPreview({ cookies: { get: () => ({ value: TOKEN_OK }) } })).toBe(true)
  })

  it('ZapPreview announces /api/zap-preview unless told otherwise, null included', () => {
    const element = (props: Parameters<typeof ZapPreview>[0]) =>
      ZapPreview(props) as unknown as { props: { draftRoute: string | null; siteKey: string } }
    expect(DEFAULT_DRAFT_ROUTE).toBe('/api/zap-preview')
    expect(element({ siteKey: 'v' }).props).toMatchObject({
      siteKey: 'v',
      draftRoute: '/api/zap-preview',
    })
    expect(element({ siteKey: 'v', draftRoute: '/es/preview' }).props.draftRoute).toBe(
      '/es/preview',
    )
    expect(element({ siteKey: 'v', draftRoute: null }).props.draftRoute).toBeNull()
  })
})
