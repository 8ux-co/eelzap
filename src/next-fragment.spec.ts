import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDraftModeRoute, PREVIEW_TOKEN_COOKIE } from './next'
import { draftModeUrl } from './preview/editor'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
  history.replaceState(null, '', '/')
})

describe('fragment navigation → form POST → clean redirect', () => {
  const token = `zpt_${'A'.repeat(43)}`
  const draftRoute = '/api/zap-preview'

  it('exchanges the actual editor URL without sending the token in any HTTP URL', async () => {
    const enable = vi.fn()
    const validate = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ site: { key: 'site' } }),
    )
    const handler = createDraftModeRoute({
      siteKey: 'site',
      apiKey: 'secret',
      draftMode: async () => ({ enable }),
      fetch: validate,
    })
    const url = new URL(
      draftModeUrl({
        origin: location.origin,
        draftRoute,
        token,
        path: '/blog?x=1#note',
        capabilities: ['fragment-token'],
      })!,
    )
    history.replaceState(null, '', url)
    // HTTP clients omit the fragment from the request target.
    const requestUrl = `${url.origin}${url.pathname}${url.search}`
    expect(requestUrl).not.toContain(token)
    const page = await handler(new Request(requestUrl))
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(enable).not.toHaveBeenCalled()
    expect(validate).not.toHaveBeenCalled()
    const html = await page.text()
    expect(html).not.toContain(token)
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const script = parsed.querySelector('script')!
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(script.textContent).toBe('')
    expect(script.getAttribute('src')).toBe('?script=1')
    const scriptUrl = new URL(script.getAttribute('src')!, requestUrl)
    expect(scriptUrl.origin).toBe(url.origin)
    expect(scriptUrl.pathname).toBe(draftRoute)
    expect(scriptUrl.href).not.toContain(token)
    const asset = await handler(new Request(scriptUrl))
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    expect(asset.headers.get('cache-control')).toBe('no-store')
    expect(asset.headers.getSetCookie()).toEqual([])
    expect(enable).not.toHaveBeenCalled()
    expect(validate).not.toHaveBeenCalled()
    const source = await asset.text()
    expect(source).not.toContain(token)
    let submitted!: Request
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
      this: HTMLFormElement,
    ) {
      expect(location.hash).toBe('')
      expect(location.search).toBe('')
      expect(this.method).toBe('post')
      expect(this.action).toBe(`${url.origin}${draftRoute}`)
      expect(this.action).not.toContain(token)
      const body = new URLSearchParams()
      for (const input of this.querySelectorAll('input')) body.append(input.name, input.value)
      expect(body.get('token')).toBe(token)
      expect(body.get('path')).toBe('/blog?x=1#note')
      submitted = new Request(this.action, {
        method: this.method,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Sec-Fetch-Site': 'same-origin',
          Origin: url.origin,
        },
        body: body.toString(),
      })
    })
    // Execute the script delivered by the route against the DOM, including the form it renders.
    new Function('location', 'history', 'document', source)(location, history, document)
    const response = await handler(submitted)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/blog?x=1#note')
    expect(response.headers.get('location')).not.toContain(token)
    expect(response.headers.getSetCookie()[0]).toContain(`${PREVIEW_TOKEN_COOKIE}=${token}`)
    expect(enable).toHaveBeenCalledTimes(1)
    expect(validate.mock.calls[0]?.[0]).not.toContain(token)
  })

  it.each(['', '#token=zpt_short&path=%2F'])(
    'clears an absent or malformed fragment without posting: %s',
    async (fragment) => {
      const enable = vi.fn()
      const handler = createDraftModeRoute({
        siteKey: 'site',
        apiKey: 'secret',
        draftMode: async () => ({ enable }),
      })
      history.replaceState(null, '', `${draftRoute}${fragment}`)
      const page = await handler(new Request(`${location.origin}${draftRoute}`))
      const parsed = new DOMParser().parseFromString(await page.text(), 'text/html')
      const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
      const script = parsed.querySelector('script')!
      expect(script.textContent).toBe('')
      const asset = await handler(new Request(new URL(script.getAttribute('src')!, location.href)))
      new Function('location', 'history', 'document', await asset.text())(
        location,
        history,
        document,
      )
      expect(location.hash).toBe('')
      expect(submit).not.toHaveBeenCalled()
      expect(enable).not.toHaveBeenCalled()
    },
  )
})
