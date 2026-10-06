import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createClient, type ClientConfig } from './client'
import { EelZapError } from './errors'
import { parseRetryAfter, resolveRetry, retryDelay } from './retry'

/*
 * The client retries a refused request (429, or 503 with Retry-After) when it
 * is safe to repeat: a read, or a write carrying an Idempotency-Key. Asserted
 * on the requests `fetch` receives, through the public client.
 */

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0)

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function refused(status: 429 | 503, retryAfter?: string): Response {
  return json(
    { error: { code: status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE', message: 'Wait.', status } },
    status,
    retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
  )
}

const SITE = { id: 's1', name: 'Verde', defaultLocale: 'es', locales: ['es'] }

function client(fetchMock: ReturnType<typeof vi.fn>, config: Partial<ClientConfig> = {}) {
  return createClient({ apiKey: 'secret_test', fetch: fetchMock, ...config })
}

/** Settles `promise` while running every timer it waits on; returns how long that took. */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const start = Date.now()
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  await vi.runAllTimersAsync()
  return { ...(await outcome), ms: Date.now() - start }
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('retry: reads', () => {
  it('retries a 429 read after Retry-After seconds, then returns the answer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refused(429, '2'))
      .mockResolvedValueOnce(json(SITE))

    const { value, ms } = await settle(client(fetchMock).site.get())

    expect(value).toMatchObject({ id: 's1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ms).toBe(2000)
  })

  it('reads Retry-After as an HTTP-date', async () => {
    const at = new Date(NOW + 5000).toUTCString()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refused(429, at))
      .mockResolvedValueOnce(json(SITE))

    const { ms } = await settle(client(fetchMock).site.get())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ms).toBe(5000)
  })

  it('backs off exponentially when a 429 has no Retry-After', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refused(429))
      .mockResolvedValueOnce(refused(429))
      .mockResolvedValueOnce(refused(429))
      .mockResolvedValueOnce(json(SITE))
    const onRetry = vi.fn()

    await settle(client(fetchMock, { retry: { onRetry } }).site.get())

    // Half of 500, 1000, 2000 with the jitter at 0.
    expect(onRetry.mock.calls.map(([event]) => (event as { delayMs: number }).delayMs)).toEqual([
      250, 500, 1000,
    ])
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({
      attempt: 1,
      status: 429,
      method: 'GET',
      url: 'https://api.eelzap.com/v1/site',
    })
  })

  it('gives up after `retries` and throws the 429', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(refused(429, '1')))

    const { error } = await settle(client(fetchMock, { retry: { retries: 2 } }).site.get())

    expect(error).toBeInstanceOf(EelZapError)
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not wait out a Retry-After longer than maxDelayMs', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(refused(429, '120'))

    const { error, ms } = await settle(client(fetchMock).site.get())

    expect(error).toMatchObject({ status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ms).toBe(0)
  })

  it('retries a 503 that carries Retry-After, and not one without', async () => {
    const withHeader = vi
      .fn()
      .mockResolvedValueOnce(refused(503, '3'))
      .mockResolvedValueOnce(json(SITE))
    expect((await settle(client(withHeader).site.get())).value).toMatchObject({ id: 's1' })
    expect(withHeader).toHaveBeenCalledTimes(2)

    const without = vi.fn().mockResolvedValueOnce(refused(503))
    expect((await settle(client(without).site.get())).error).toMatchObject({ status: 503 })
    expect(without).toHaveBeenCalledTimes(1)
  })

  it('never retries other failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ error: { code: 'INTERNAL_ERROR', message: 'x', status: 500 } }, 500),
      )

    expect((await settle(client(fetchMock).site.get())).error).toMatchObject({ status: 500 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('`retry: false` turns it off', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(refused(429, '1'))

    const { error } = await settle(client(fetchMock, { retry: false }).site.get())

    expect(error).toMatchObject({ status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('retry: writes', () => {
  it('retries a write that carries an Idempotency-Key, with the same key and body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(refused(429, '1'))
      .mockResolvedValueOnce(json({ collection: { key: 'blog', name: 'Blog' } }, 201))

    const { value } = await settle(
      client(fetchMock).collections.create({ name: 'Blog', key: 'blog' }, { idempotencyKey: 'k1' }),
    )

    expect(value).toMatchObject({ key: 'blog' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [first, second] = fetchMock.mock.calls.map(([, init]) => init as RequestInit)
    expect(new Headers(first?.headers).get('Idempotency-Key')).toBe('k1')
    expect(new Headers(second?.headers).get('Idempotency-Key')).toBe('k1')
    expect(second?.body).toBe(first?.body)
  })

  it('never retries a write without an Idempotency-Key', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(refused(429, '1'))

    const { error } = await settle(client(fetchMock).collections.update('blog', { name: 'Diario' }))

    expect(error).toMatchObject({ status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
  })
})

describe('retry: helpers', () => {
  it('parses Retry-After', () => {
    expect(parseRetryAfter('7', NOW)).toBe(7000)
    expect(parseRetryAfter(new Date(NOW - 1000).toUTCString(), NOW)).toBe(0)
    expect(parseRetryAfter('soon', NOW)).toBeNull()
    expect(parseRetryAfter(null, NOW)).toBeNull()
  })

  it('adds up to a second of jitter to Retry-After, within maxDelayMs', () => {
    const options = resolveRetry(undefined)!
    expect(retryDelay(refused(429, '2'), 1, options, NOW, () => 0.5)).toBe(2500)
    expect(retryDelay(refused(429, '60'), 1, options, NOW, () => 0.99)).toBe(60_000)
  })

  it('resolves the option', () => {
    expect(resolveRetry(false)).toBeNull()
    expect(resolveRetry({ retries: 0 })).toBeNull()
    expect(resolveRetry(true)).toMatchObject({ retries: 3, maxDelayMs: 60_000, baseDelayMs: 500 })
    expect(resolveRetry({ maxDelayMs: 5000 })).toMatchObject({ retries: 3, maxDelayMs: 5000 })
  })
})
