import { describe, expect, it, vi } from 'vitest'

import { EelZapNetworkError } from './errors'
import { HttpClient } from './http'

function createResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  })
}

describe('HttpClient', () => {
  it('sends auth headers and query params through get', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createResponse({ ok: true }))
    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/v1',
      fetch: fetchMock,
      defaultHeaders: {
        'X-Test': '1',
      },
      timeout: 1_000,
    })

    await client.get('/collections', {
      params: {
        status: 'published',
        page: 2,
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    expect(url).toBe('https://api.eelzap.com/v1/collections?status=published&page=2')
    expect(headers).toMatchObject({
      authorization: 'Bearer secret_1234',
      'x-test': '1',
    })
    expect(init.method).toBe('GET')
  })

  it('throws EelZapError for JSON API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createResponse(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Missing.',
            status: 404,
          },
        },
        { status: 404 },
      ),
    )
    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/api/public/v1',
      fetch: fetchMock,
      timeout: 1_000,
    })

    await expect(client.get('/documents/homepage')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Missing.',
      status: 404,
      details: [],
    })
  })

  it('carries the per-field details of a validation refusal', async () => {
    const details = [{ path: 'key', message: 'Required', code: 'invalid_type' }]
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createResponse(
        {
          error: {
            code: 'INVALID_PARAMS',
            message: 'Invalid input: key: Required',
            status: 400,
            details,
          },
        },
        { status: 400 },
      ),
    )
    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/api/public/v1',
      fetch: fetchMock,
      timeout: 1_000,
      retry: null,
    })

    await expect(client.get('/documents/homepage')).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      status: 400,
      details,
    })
  })

  it('wraps transport failures as network errors', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('socket closed'))
    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/api/public/v1',
      fetch: fetchMock,
      timeout: 1_000,
    })

    await expect(client.get('/collections')).rejects.toBeInstanceOf(EelZapNetworkError)
  })

  it('returns undefined for a 204 with no body instead of failing to parse it', async () => {
    // `DELETE …/versions/draft` answers 204 with no body on success.
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/api/public/v1',
      fetch: fetchMock,
      timeout: 1_000,
    })

    await expect(client.delete('/documents/home/versions/draft')).resolves.toBeUndefined()
  })

  it('returns undefined for 304 responses and falls back for non-json errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
        }),
      )
      .mockResolvedValueOnce(
        new Response('server error', {
          status: 500,
          headers: {
            'Content-Type': 'text/plain',
          },
        }),
      )
    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/api/public/v1',
      fetch: fetchMock,
      timeout: 1_000,
    })

    await expect(client.get('/collections')).resolves.toBeUndefined()
    await expect(client.get('/collections')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Request failed with status 500.',
    })
  })

  it('supports requests without params and falls back when the json error payload is malformed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse({ data: [] }))
      .mockResolvedValueOnce(
        createResponse(
          {},
          {
            status: 502,
          },
        ),
      )
    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/api/public/v1',
      fetch: fetchMock,
      timeout: 1_000,
    })

    await expect(client.get('/collections')).resolves.toEqual({ data: [] })
    await expect(client.get('/collections')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 502,
      message: 'Request failed with status 502.',
    })
  })

  it('aborts timed out requests', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })
    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/api/public/v1',
      fetch: fetchMock as typeof fetch,
      timeout: 50,
    })

    const request = client.get('/collections')
    const assertion = expect(request).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'aborted',
    })
    await vi.advanceTimersByTimeAsync(50)
    await assertion

    vi.useRealTimers()
  })

  it('handles non-error thrown values and missing content-type headers', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          ({
            then(_resolve: unknown, reject: ((reason?: unknown) => void) | undefined) {
              reject?.()
            },
          }) as Promise<Response>,
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 503,
        }),
      )
    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/api/public/v1',
      fetch: fetchMock,
      timeout: 1_000,
    })

    await expect(client.get('/collections')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'Network request failed.',
    })
    await expect(client.get('/collections')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 503,
      message: 'Request failed with status 503.',
    })
  })

  it('serializes JSON bodies for write methods and supports upload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse({ created: true }, { status: 201 }))
      .mockResolvedValueOnce(createResponse({ updated: true }))
      .mockResolvedValueOnce(createResponse({ deleted: true }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/v1',
      fetch: fetchMock,
      timeout: 1_000,
    })

    await expect(client.post('/collections', { name: 'Blog' })).resolves.toEqual({ created: true })
    await expect(client.patch('/collections/blog', { name: 'Posts' })).resolves.toEqual({
      updated: true,
    })
    await expect(
      client.delete('/collections/blog', { deleteMediaIds: ['media_1'] }),
    ).resolves.toEqual({ deleted: true })
    await expect(
      client.upload('https://upload.example.com', new Uint8Array([1, 2]), {
        'Content-Type': 'image/png',
      }),
    ).resolves.toBeUndefined()

    const [, postInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const [, deleteInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[3] as [string, RequestInit]

    expect(postInit.method).toBe('POST')
    expect(postInit.body).toBe(JSON.stringify({ name: 'Blog' }))
    expect(new Headers(postInit.headers).get('content-type')).toBe('application/json')
    expect(patchInit.method).toBe('PATCH')
    expect(deleteInit.method).toBe('DELETE')
    expect(uploadUrl).toBe('https://upload.example.com')
    expect(uploadInit.method).toBe('PUT')
    expect(new Headers(uploadInit.headers).get('content-type')).toBe('image/png')
  })

  it('supports empty path prefixes, request aliasing, and upload failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse({ ok: true }))
      .mockResolvedValueOnce(
        createResponse(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests.',
              status: 429,
            },
          },
          { status: 429 },
        ),
      )

    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/',
      fetch: fetchMock,
      timeout: 1_000,
    })

    await expect(client.request('/site')).resolves.toEqual({ ok: true })
    await expect(
      client.upload('https://upload.example.com', new Blob(['x'])),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.eelzap.com/site')
  })

  it('preserves provided options when no JSON body is supplied and infers content type for raw bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse({ ok: true }))
      .mockResolvedValueOnce(createResponse({ ok: true }))
      .mockResolvedValueOnce(createResponse({ ok: true }))

    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/v1',
      fetch: fetchMock,
      timeout: 1_000,
    })

    await expect(
      client.post('/collections', undefined, { headers: { 'X-Test': '1' } }),
    ).resolves.toEqual({
      ok: true,
    })
    await expect(
      client.request('/collections', {
        body: '{}',
        headers: { 'X-Raw': '1' },
      }),
    ).resolves.toEqual({ ok: true })
    await expect(client.put('/collections')).resolves.toEqual({ ok: true })

    const [, postInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const [, putInit] = fetchMock.mock.calls[2] as [string, RequestInit]

    expect(new Headers(postInit.headers).get('x-test')).toBe('1')
    expect(postInit.body).toBeUndefined()
    expect(new Headers(requestInit.headers).get('content-type')).toBe('application/json')
    expect(requestInit.body).toBe('{}')
    expect(putInit.method).toBe('PUT')
    expect(putInit.body).toBeUndefined()
  })

  it('wraps upload timeouts and transport failures as network errors', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
      })
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))

    const client = new HttpClient({
      apiKey: 'secret_1234',
      baseUrl: 'https://api.eelzap.com/',
      pathPrefix: '/v1',
      fetch: fetchMock as typeof fetch,
      timeout: 50,
    })

    const timedOutUpload = client.upload('https://upload.example.com', new Blob(['x']))
    const timedOutAssertion = expect(timedOutUpload).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'aborted',
    })
    await vi.advanceTimersByTimeAsync(50)
    await timedOutAssertion
    await expect(
      client.upload('https://upload.example.com', new Blob(['x'])),
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'boom',
    })

    vi.useRealTimers()
  })
})
