import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PENDING_STORAGE_KEY, STATE_PREFIX, TOKEN_STORAGE_KEY } from './config'
import {
  authorizeUrl,
  challengeFor,
  checkCallback,
  createState,
  createVerifier,
  exchangeCode,
  ExchangeError,
  isReturnPath,
  returnPathOf,
  savePending,
  takePending,
  type PendingSignIn,
} from './oauth'
import { clearToken, readToken, writeToken } from './token'

/**
 * The site client's OAuth (ADR 024, ADR 041 §7, zap-cms-v2 §3.4): every
 * refusal attempted, both directions where there are two.
 */

const NEST = 'https://auth.eel.software'
const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CTX = {
  win: window,
  siteId: SITE,
  authOrigin: NEST,
  clientId: `https://zap.eel.software/oauth/clients/${SITE}.json`,
  redirectUri: 'https://ejemplo.com/',
}
const PENDING: PendingSignIn = {
  state: `${STATE_PREFIX}abc`,
  verifier: 'v'.repeat(43),
  mode: 'popup',
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('the callback check', () => {
  const good = { code: 'the-code', state: PENDING.state, iss: NEST }

  it('accepts exactly the state this tab minted, from the expected issuer', () => {
    expect(checkCallback(good, PENDING, NEST)).toBeNull()
  })

  it('refuses a state mismatch, and a callback with no sign-in pending', () => {
    expect(checkCallback({ ...good, state: `${STATE_PREFIX}abd` }, PENDING, NEST)).toBe('state')
    expect(checkCallback({ ...good, state: `${PENDING.state}x` }, PENDING, NEST)).toBe('state')
    expect(checkCallback({ ...good, state: undefined }, PENDING, NEST)).toBe('state')
    expect(checkCallback(good, null, NEST)).toBe('state')
  })

  it('refuses an issuer mismatch, a missing one, and a look-alike', () => {
    expect(checkCallback({ ...good, iss: 'https://evil.example' }, PENDING, NEST)).toBe('iss')
    expect(checkCallback({ ...good, iss: undefined }, PENDING, NEST)).toBe('iss')
    expect(checkCallback({ ...good, iss: `${NEST}/` }, PENDING, NEST)).toBe('iss')
    expect(
      checkCallback({ ...good, iss: 'https://auth.eel.software.evil.example' }, PENDING, NEST),
    ).toBe('iss')
  })

  it('refuses a missing or oversized code', () => {
    expect(checkCallback({ ...good, code: '' }, PENDING, NEST)).toBe('code')
    expect(checkCallback({ ...good, code: 'x'.repeat(513) }, PENDING, NEST)).toBe('code')
  })
})

describe('PKCE and the authorize URL', () => {
  it('the challenge is BASE64URL(SHA-256(verifier)), checked against Node crypto', async () => {
    const verifier = createVerifier(window)
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(await challengeFor(window, verifier)).toBe(expected)
    expect(expected).not.toMatch(/[+/=]/)
  })

  it('makes 43-char verifiers and unpredictable states with our prefix', () => {
    expect(createVerifier(window)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const a = createState(window)
    const b = createState(window)
    expect(a.startsWith(STATE_PREFIX)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('asks Nest for S256, zap:suggest:write alone, the exact redirect and the site client', () => {
    const url = new URL(authorizeUrl(CTX, `${STATE_PREFIX}s`, 'CHALLENGE'))
    expect(url.origin + url.pathname).toBe(`${NEST}/oauth/authorize`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: CTX.clientId,
      redirect_uri: 'https://ejemplo.com/',
      code_challenge: 'CHALLENGE',
      code_challenge_method: 'S256',
      state: `${STATE_PREFIX}s`,
      scope: 'zap:suggest:write',
    })
  })
})

describe('the return path a full-page sign-in carries in its state', () => {
  it('round-trips a same-origin path with query and hash', () => {
    const path = '/blog/cosecha?zap&x=1#titulo'
    expect(returnPathOf(createState(window, path))).toBe(path)
  })

  it.each([
    '//evil.example/x',
    '/\\evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    '/a b',
  ])('never carries %s', (path) => {
    expect(isReturnPath(path)).toBe(false)
    expect(returnPathOf(createState(window, path))).toBeNull()
  })

  it('refuses a hand-made state whose path is off-origin', () => {
    const encoded = btoa('//evil.example').replace(/=+$/, '')
    expect(returnPathOf(`${STATE_PREFIX}nonce.${encoded}`)).toBeNull()
  })
})

describe('the code exchange', () => {
  const answer = (body: unknown, status = 200) =>
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))

  it('posts the form with the verifier, no cookies, no custom header, and keeps no refresh token', async () => {
    const fetchMock = answer({
      access_token: 'eel_at_ABCDEFGHIJKL_0123456789',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'eel_rt_should_never_be_kept',
    })
    const token = await exchangeCode(CTX, 'the-code', 'the-verifier', 1_000)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${NEST}/api/oauth/token`)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('omit')
    expect(init?.headers).toBeUndefined()
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: CTX.clientId,
      redirect_uri: CTX.redirectUri,
      code_verifier: 'the-verifier',
    })
    expect(token).toEqual({
      token: 'eel_at_ABCDEFGHIJKL_0123456789',
      exp: 1_000 + 3_600_000,
      site: SITE,
    })
    expect(JSON.stringify(token)).not.toContain('eel_rt_')
  })

  it('caps the lifetime at one hour whatever the answer claims', async () => {
    answer({ access_token: 'eel_at_ABCDEFGHIJKL_0123456789', expires_in: 86_400 })
    expect((await exchangeCode(CTX, 'c', 'v', 0)).exp).toBe(3_600_000)
  })

  it.each([
    [{ access_token: 'not-ours', expires_in: 3600 }],
    [{ access_token: 'eel_at_<script>', expires_in: 3600 }],
    [{ access_token: 'eel_at_ABCDEFGHIJKL_0123456789' }],
  ])('refuses a malformed answer %j', async (body) => {
    answer(body)
    await expect(exchangeCode(CTX, 'c', 'v')).rejects.toBeInstanceOf(ExchangeError)
  })

  it('refuses a non-2xx answer', async () => {
    answer({ error: 'invalid_grant' }, 400)
    await expect(exchangeCode(CTX, 'c', 'v')).rejects.toMatchObject({ status: 400 })
  })
})

describe('the pending full-page sign-in', () => {
  it('is good for one callback', () => {
    savePending(window, { ...PENDING, mode: 'redirect' })
    expect(takePending(window)).toEqual({ ...PENDING, mode: 'redirect' })
    expect(takePending(window)).toBeNull()
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
  })

  it('a malformed entry is nothing', () => {
    sessionStorage.setItem(PENDING_STORAGE_KEY, '{"state":1}')
    expect(takePending(window)).toBeNull()
  })
})

describe('the token store (ADR 041 §7)', () => {
  const token = { token: 'eel_at_ABCDEFGHIJKL_0123456789', exp: Date.now() + 3_600_000, site: SITE }

  it('lives in sessionStorage only: never localStorage, never a cookie', () => {
    writeToken(window, token)
    expect(JSON.parse(sessionStorage.getItem(TOKEN_STORAGE_KEY)!)).toEqual(token)
    expect(localStorage.length).toBe(0)
    expect(document.cookie).not.toContain('eel_at_')
    expect(readToken(window, SITE)).toEqual(token)
  })

  it('reads as nothing, and is removed, when expired, for another site or malformed', () => {
    writeToken(window, { ...token, exp: Date.now() + 10_000 })
    expect(readToken(window, SITE)).toBeNull()
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    writeToken(window, token)
    expect(readToken(window, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBeNull()
    writeToken(window, { ...token, token: 'zpt_preview' })
    expect(readToken(window, SITE)).toBeNull()
  })

  it('clearing forgets it', () => {
    writeToken(window, token)
    clearToken(window)
    expect(readToken(window, SITE)).toBeNull()
  })
})
