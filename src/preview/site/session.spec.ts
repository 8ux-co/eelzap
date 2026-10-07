import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiResult } from './api'
import { createTokenSession, REFRESH_LEAD_MS, type TokenSession } from './session'
import { readSession, writeToken, type SiteToken } from './token'

/**
 * The site client's token lifecycle (ADR 041 amendment 2026-10-06; item 32):
 * a 401 renews silently and retries once; a renewal that fails is the expired
 * state (never the «no access» refusal); the hour is renewed two minutes
 * ahead; a tab coming back from sleep checks at once; one renewal at a time.
 */

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NEST = 'https://auth.eel.software'
const CLIENT = `https://zap.eel.software/oauth/clients/${SITE}.json`
const ACCESS = 'eel_at_ABCDEFGHIJKL_0123456789'
const ACCESS_2 = 'eel_at_ZYXWVUTSRQPO_9876543210'
const REFRESH = 'eel_rt_ABCDEFGHIJKL_0123456789'
const REFRESH_2 = 'eel_rt_ZYXWVUTSRQPO_9876543210'

const ctx = {
  win: window,
  doc: document,
  authOrigin: NEST,
  clientId: CLIENT,
  siteId: SITE,
}

let now: number
let session: TokenSession | null = null
let onExpired: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn>

const stored = (over: Partial<SiteToken> = {}): SiteToken => ({
  token: ACCESS,
  exp: now + 3_600_000,
  site: SITE,
  refresh: REFRESH,
  rexp: now + 8 * 3_600_000,
  ...over,
})

const renewed = () =>
  new Response(
    JSON.stringify({
      access_token: ACCESS_2,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: REFRESH_2,
    }),
    { status: 200 },
  )

function start(value: SiteToken = stored()) {
  writeToken(window, value)
  session = createTokenSession(ctx, value, { onExpired }, { now: () => now })
  return session
}

/** Settle pending promises (timers are fake here, so no `setTimeout` tick). */
const tick = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

const refreshCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url) === `${NEST}/api/oauth/token`)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  now = Date.now()
  sessionStorage.clear()
  onExpired = vi.fn()
  fetchMock = vi.fn(async () => renewed())
  vi.spyOn(window, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch)
})

afterEach(() => {
  session?.destroy()
  session = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a 401 renews silently and retries once', () => {
  it('401 → refresh at Nest → the same request again with the new token, which succeeds', async () => {
    const s = start()
    const request = vi.fn(
      async (token: string): Promise<ApiResult<string>> =>
        token === ACCESS ? { ok: false, kind: 'expired' } : { ok: true, data: 'hecho' },
    )
    const result = await s.call(request)
    expect(result).toEqual({ ok: true, data: 'hecho' })
    expect(request.mock.calls.map(([token]) => token)).toEqual([ACCESS, ACCESS_2])

    const [[url, init]] = refreshCalls() as [[string, RequestInit]]
    expect(url).toBe(`${NEST}/api/oauth/token`)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: REFRESH,
      client_id: CLIENT,
    })
    // The rotated pair is what the tab now holds.
    expect(readSession(window, SITE)).toMatchObject({ token: ACCESS_2, refresh: REFRESH_2 })
    expect(onExpired).not.toHaveBeenCalled()
  })

  it('a second 401 after a good renewal is the expired state, not a loop', async () => {
    const s = start()
    const request = vi.fn(async (): Promise<ApiResult<string>> => ({ ok: false, kind: 'expired' }))
    const result = await s.call(request)
    expect(result).toEqual({ ok: false, kind: 'expired' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('a 403 is passed through untouched: no renewal, not expired', async () => {
    const s = start()
    const result = await s.call(async () => ({ ok: false, kind: 'forbidden' }) as const)
    expect(result).toEqual({ ok: false, kind: 'forbidden' })
    expect(refreshCalls()).toHaveLength(0)
    expect(onExpired).not.toHaveBeenCalled()
  })
})

describe('renewal fails: the expired state', () => {
  it.each([
    [
      'Nest refuses (consent revoked, past its 30 days, another origin)',
      () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    ],
    [
      'Nest unreachable or CORS-less',
      () => {
        throw new TypeError('Failed to fetch')
      },
    ],
    ['a malformed answer', () => new Response(JSON.stringify({ access_token: 'nope' }))],
  ])('%s → onExpired once, the tokens forgotten', async (_name, answer) => {
    fetchMock.mockImplementation(async () => answer())
    const s = start()
    const result = await s.call(async () => ({ ok: false, kind: 'expired' }) as const)
    expect(result).toEqual({ ok: false, kind: 'expired' })
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(s.expired).toBe(true)
    expect(readSession(window, SITE)).toBeNull()
    // Expired calls do not reach the network.
    const request = vi.fn()
    expect(await s.call(request)).toEqual({ ok: false, kind: 'expired' })
    expect(request).not.toHaveBeenCalled()
  })

  it('no refresh token at all (an older sign-in): straight to expired, no call to Nest', async () => {
    const s = start(stored({ refresh: undefined, rexp: undefined }))
    await s.call(async () => ({ ok: false, kind: 'expired' }) as const)
    expect(refreshCalls()).toHaveLength(0)
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('a refresh token past its eight hours is not tried', async () => {
    const s = start(stored({ rexp: now - 1 }))
    await s.call(async () => ({ ok: false, kind: 'expired' }) as const)
    expect(refreshCalls()).toHaveLength(0)
    expect(onExpired).toHaveBeenCalledTimes(1)
  })
})

describe('renewing ahead of time', () => {
  it('the timer renews two minutes before the hour ends, not earlier', async () => {
    start()
    await tick()
    vi.advanceTimersByTime(3_600_000 - REFRESH_LEAD_MS - 1_000)
    expect(refreshCalls()).toHaveLength(0)
    now += 3_600_000 - REFRESH_LEAD_MS
    vi.advanceTimersByTime(1_000)
    await vi.waitFor(() => expect(session!.token()).toBe(ACCESS_2))
    expect(refreshCalls()).toHaveLength(1)
    expect(onExpired).not.toHaveBeenCalled()
  })

  it('a stored session whose hour is already spent renews at once', async () => {
    start(stored({ exp: now - 1_000 }))
    await vi.waitFor(() => expect(session!.token()).toBe(ACCESS_2))
    expect(refreshCalls()).toHaveLength(1)
  })

  it('concurrent needs share ONE renewal (rotation would refuse a second)', async () => {
    const s = start(stored({ exp: now - 1_000 }))
    const [a, b] = await Promise.all([s.ensure(), s.ensure()])
    expect(a).toBe(ACCESS_2)
    expect(b).toBe(ACCESS_2)
    expect(refreshCalls()).toHaveLength(1)
  })
})

describe('a tab coming back from sleep', () => {
  function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })

  it('visibilitychange to visible checks the expiry and renews when near the end', async () => {
    start()
    await tick()
    // The tab slept through the timer: the clock moved, the timer did not fire.
    now += 3_600_000 - 60_000
    setVisibility('visible')
    await vi.waitFor(() => expect(session!.token()).toBe(ACCESS_2))
    expect(refreshCalls()).toHaveLength(1)
  })

  it('visibilitychange with plenty of hour left renews nothing', async () => {
    start()
    await tick()
    now += 10 * 60_000
    setVisibility('visible')
    await tick()
    expect(refreshCalls()).toHaveLength(0)
  })

  it('a hidden tab does not check', async () => {
    start()
    await tick()
    now += 3_600_000
    setVisibility('hidden')
    await tick()
    expect(refreshCalls()).toHaveLength(0)
  })

  it('woke past the hour and renewal fails: expired', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 400 }))
    start()
    await tick()
    now += 2 * 3_600_000
    setVisibility('visible')
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1))
  })
})
