import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stegaEncode } from '../stega'
import {
  __resetLiveForTests,
  cleanStega,
  developmentZapOrigin,
  getPreviewToken,
  initZap,
  onValues,
  PREVIEW_TOKEN_STORAGE_KEY,
  previewHeaders,
  recordRefsOf,
  ZAP_PRODUCTION_ORIGIN,
  zapAttrs,
} from './live'
import { OVERLAY_HOST_TAG } from './overlay'
import { envelope, MAX_MESSAGE_BYTES } from './protocol'

/**
 * The Live client's trust rules (zap-cms-v2 §2.6 "Origins", §7.3): every
 * rejection is attempted — wrong origin, wrong source, no session, another
 * session, oversized, another site's hello — and each must leave the page
 * untouched: no overlay element, no stored token, no handler called.
 */

const ZAP = ZAP_PRODUCTION_ORIGIN
const LOCAL_ZAP = 'http://localhost:5047'
const SESSION = '0123456789abcdef0123456789abcdef'
const OTHER = 'ffffffffffffffffffffffffffffffff'
const TOKEN = `zpt_${'A'.repeat(43)}`

function hello(session = SESSION, overrides: Record<string, unknown> = {}) {
  return envelope('zap:hello', session, {
    session,
    siteKey: 'verdeorigen',
    locale: 'es',
    labels: { title: 'Título' },
    recordRef: 'blog/hola',
    mode: 'inspect',
    previewToken: TOKEN,
    ...overrides,
  })
}

const values = (session = SESSION, recordRef = 'blog/hola') =>
  envelope('zap:values', session, { recordRef, locale: 'es', patch: { title: 'Borrador' } })

function boot(
  options: { zapOrigin?: string; siteKey?: string; draftRoute?: string | null; html?: string } = {},
) {
  document.body.innerHTML = options.html ?? '<h1 data-zap="blog/hola#title">Publicado</h1>'
  const parent = { postMessage: vi.fn() }
  const live = initZap(
    {
      siteKey: options.siteKey ?? 'verdeorigen',
      zapOrigin: options.zapOrigin,
      draftRoute: options.draftRoute,
    },
    { win: window, doc: document, parent, throttleMs: 0 },
  )
  const deliver = (data: unknown, init: { origin?: string; source?: unknown } = {}) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        origin: init.origin ?? ZAP,
        source: (init.source === undefined ? parent : init.source) as MessageEventSource,
      }),
    )
  const title = () => document.querySelector('h1')!.textContent
  const overlayMounted = () => document.querySelector(OVERLAY_HOST_TAG) !== null
  return { live, parent, deliver, title, overlayMounted }
}

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  __resetLiveForTests()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('initZap: the handshake', () => {
  it('does nothing at all outside a frame', () => {
    const live = initZap({ siteKey: 'verdeorigen' }, { win: window, parent: window as never })
    expect(live.active).toBe(false)
    expect(live.runtime).toBeNull()
  })

  it('announces zap:ready to the exact Zap origin, never "*", with no session yet', () => {
    const { parent, overlayMounted } = boot()
    expect(parent.postMessage).toHaveBeenCalled()
    for (const [message, target] of parent.postMessage.mock.calls) {
      expect(target).toBe(ZAP)
      expect(target).not.toBe('*')
      expect(message).toMatchObject({ source: 'eel-zap', session: '' })
    }
    const types = parent.postMessage.mock.calls.map(([m]) => (m as { type: string }).type)
    expect(types[0]).toBe('zap:ready')
    // Nothing is drawn before a verified hello.
    expect(overlayMounted()).toBe(false)
  })

  it('a verified hello mounts the overlay, keeps the token, and values update the page', () => {
    const { deliver, title, overlayMounted } = boot()
    deliver(hello())
    expect(overlayMounted()).toBe(true)
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBe(TOKEN)
    deliver(values())
    expect(title()).toBe('Borrador')
  })

  it('answers the origin that said hello, and only it', () => {
    // Two trusted editors: production and a local Zap (jsdom's page is localhost).
    const { parent, deliver } = boot({ zapOrigin: LOCAL_ZAP })
    parent.postMessage.mockClear()
    deliver(hello(), { origin: LOCAL_ZAP })
    // The hello is answered with the tag report, to the editor that said it.
    const calls = parent.postMessage.mock.calls
    expect(calls.map(([m]) => (m as { type: string }).type)).toContain('zap:tags')
    for (const [message, target] of calls) {
      expect(target).toBe(LOCAL_ZAP)
      expect(message).toMatchObject({ session: SESSION })
    }
  })
})

describe('initZap: what it refuses', () => {
  it.each([
    'https://evil.example',
    'http://zap.eel.software',
    'https://zap.eel.software.evil.example',
    'null',
    // Zap's own preview deployments are not editors.
    'https://eel-zap-web-a1b2c3d4e-example-team.vercel.app',
    'https://eel-zap-web-git-main-example-team.vercel.app',
    'http://localhost:5047',
  ])('a hello from %s', (origin) => {
    const { live, deliver, title, overlayMounted } = boot()
    deliver(hello(), { origin })
    deliver(values(), { origin })
    expect(overlayMounted()).toBe(false)
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBeNull()
    expect(title()).toBe('Publicado')
    expect(live.runtime!.bridge.stats['wrong-origin']).toBe(2)
  })

  it('a hello from any window but the parent (a site script, another frame)', () => {
    const { live, deliver, overlayMounted } = boot()
    deliver(hello(), { source: window })
    deliver(hello(), { source: { postMessage() {} } })
    deliver(hello(), { source: null })
    expect(overlayMounted()).toBe(false)
    expect(live.runtime!.bridge.stats['wrong-source']).toBe(3)
  })

  it('anything before the hello (missing session)', () => {
    const { live, deliver, title } = boot()
    deliver(values(''))
    deliver(values())
    expect(title()).toBe('Publicado')
    expect(live.runtime!.bridge.stats['wrong-session']).toBe(2)
  })

  it('a message with another session after the hello, and a second hello', () => {
    const { live, deliver, title } = boot()
    deliver(hello(SESSION, { previewToken: undefined }))
    deliver(values(OTHER))
    deliver(hello(OTHER))
    expect(title()).toBe('Publicado')
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBeNull()
    expect(live.runtime!.bridge.stats['wrong-session']).toBe(2)
  })

  it('an oversized message, before it is walked', () => {
    const { live, deliver, title } = boot()
    deliver(hello())
    deliver(
      envelope('zap:values', SESSION, {
        recordRef: 'blog/hola',
        locale: 'es',
        patch: { title: 'x'.repeat(MAX_MESSAGE_BYTES) },
      }),
    )
    expect(title()).toBe('Publicado')
    expect(live.runtime!.bridge.stats.oversize).toBe(1)
  })

  it('a malformed preview token in the hello (the whole hello is invalid)', () => {
    const { live, deliver, overlayMounted } = boot()
    deliver(hello(SESSION, { previewToken: 'zpt_short' }))
    expect(overlayMounted()).toBe(false)
    expect(live.runtime!.bridge.stats['invalid-payload']).toBe(1)
  })

  it('a hello for another site: nothing drawn, stored or dispatched', () => {
    const handler = vi.fn()
    onValues('blog/hola', handler)
    const { deliver, title, overlayMounted } = boot({ siteKey: 'otro-sitio' })
    deliver(hello())
    deliver(values())
    expect(overlayMounted()).toBe(false)
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBeNull()
    expect(title()).toBe('Publicado')
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('onValues', () => {
  it('calls the handler for its entry, by any of its slugs, and never for another', () => {
    const post = {
      slug: 'hola',
      localizedSlugs: { en: 'hello' },
      collection: { key: 'blog' },
    }
    const handler = vi.fn()
    const other = vi.fn()
    onValues(post, handler)
    const stop = onValues('blog/otro', other)
    const { deliver } = boot()
    deliver(hello())
    deliver(values())
    deliver(values(SESSION, 'blog/hello'))
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[0]![0]).toEqual({ title: 'Borrador' })
    expect(other).not.toHaveBeenCalled()
    stop()
  })

  it('a handler that throws does not stop the others or the page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const second = vi.fn()
    onValues('blog/hola', () => {
      throw new Error('site bug')
    })
    onValues('blog/hola', second)
    const { deliver, title } = boot()
    deliver(hello())
    deliver(values())
    expect(second).toHaveBeenCalledTimes(1)
    expect(title()).toBe('Borrador')
  })
})

describe('trusted origins', () => {
  it('zapOrigin: a local Zap from a local page only', () => {
    expect(developmentZapOrigin('http://localhost:5047', 'localhost')).toBe('http://localhost:5047')
    expect(developmentZapOrigin('http://127.0.0.1:5047/x', '127.0.0.1')).toBe(
      'http://127.0.0.1:5047',
    )
    // A production page never trusts a local editor.
    expect(developmentZapOrigin('http://localhost:5047', 'verdeorigen.co')).toBeNull()
    // Nor any other host, local page or not.
    expect(developmentZapOrigin('https://evil.example', 'localhost')).toBeNull()
    expect(developmentZapOrigin('javascript:alert(1)', 'localhost')).toBeNull()
    expect(developmentZapOrigin(undefined, 'localhost')).toBeNull()
  })

  it('zapOrigin: http or https, and *.localhost names, count as local', () => {
    expect(developmentZapOrigin('https://localhost:5047', 'localhost')).toBe(
      'https://localhost:5047',
    )
    expect(developmentZapOrigin('https://zap.localhost', 'verde.localhost')).toBe(
      'https://zap.localhost',
    )
    expect(developmentZapOrigin('http://localhost.evil.example', 'localhost')).toBeNull()
    expect(developmentZapOrigin('http://zap.localhost', 'verdeorigen.co')).toBeNull()
  })

  it('zapOrigin on a local page lets a local Zap say hello', () => {
    const { deliver, overlayMounted } = boot({ zapOrigin: 'http://localhost:5047' })
    deliver(hello(), { origin: 'http://localhost:5047' })
    expect(overlayMounted()).toBe(true)
  })
})

describe('helpers', () => {
  it('zapAttrs names the field of an entry, a document, or a reference', () => {
    expect(zapAttrs({ slug: 'hola', collection: { key: 'blog' } }, 'title')).toEqual({
      'data-zap': 'blog/hola#title',
    })
    expect(zapAttrs({ key: 'home' }, 'hero_title')).toEqual({ 'data-zap': 'doc:home#hero_title' })
    expect(zapAttrs('doc:home', 'hero_title')).toEqual({ 'data-zap': 'doc:home#hero_title' })
    expect(zapAttrs('blog/hola', 'Title')).toEqual({})
    expect(zapAttrs('<script>', 'title')).toEqual({})
  })

  it('recordRefsOf lists the default slug first, then localized ones, without duplicates', () => {
    expect(
      recordRefsOf({
        slug: 'hola',
        localizedSlugs: { es: 'hola', en: 'hello' },
        collection: { key: 'blog' },
      }),
    ).toEqual(['blog/hola', 'blog/hello'])
  })

  it('cleanStega is the SDK one: markers go, everything else stays', () => {
    const marked = stegaEncode('Hola', { recordRef: 'blog/hola', fieldKey: 'title' })
    expect(cleanStega({ a: marked })).toEqual({ a: 'Hola' })
    expect(cleanStega('Hola')).toBe('Hola')
  })

  it('previewHeaders carries a well-formed stored token, and nothing else', () => {
    expect(previewHeaders(window)).toEqual({})
    sessionStorage.setItem(PREVIEW_TOKEN_STORAGE_KEY, 'zpt_bad')
    expect(getPreviewToken(window)).toBeNull()
    sessionStorage.setItem(PREVIEW_TOKEN_STORAGE_KEY, TOKEN)
    expect(previewHeaders(window)).toEqual({ 'x-zap-preview-token': TOKEN })
  })
})

describe('initZap: the preview token does not outlive its session', () => {
  it('destroy forgets the stored preview token', () => {
    const { live, deliver } = boot()
    deliver(hello())
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBe(TOKEN)
    live.destroy()
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBeNull()
    expect(getPreviewToken(window)).toBeNull()
  })

  it('a hello without a token forgets the one an earlier hello left', () => {
    const { deliver } = boot()
    deliver(hello())
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBe(TOKEN)
    deliver(hello(SESSION, { previewToken: undefined }))
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBeNull()
    expect(previewHeaders(window)).toEqual({})
  })

  it('a token left by an earlier page load is forgotten by a token-less hello too', () => {
    sessionStorage.setItem(PREVIEW_TOKEN_STORAGE_KEY, TOKEN)
    const { deliver } = boot()
    deliver(hello(SESSION, { previewToken: undefined }))
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('a hello for another site does not touch the stored token', () => {
    sessionStorage.setItem(PREVIEW_TOKEN_STORAGE_KEY, TOKEN)
    const { deliver } = boot()
    deliver(hello(SESSION, { siteKey: 'otro', previewToken: undefined }))
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBe(TOKEN)
  })
})

describe('initZap: draft route, stega and values for code bundled apart (zap-cms-v2 §2.4, §2.5)', () => {
  const readyOf = (parent: { postMessage: ReturnType<typeof vi.fn> }) =>
    parent.postMessage.mock.calls.map(([m]) => m).find((m) => m.type === 'zap:ready')!.payload

  it('announces the draft-mode route path and every capability, scroll-sync and diff-marks included, in zap:ready', () => {
    const { parent } = boot({ draftRoute: '/api/zap-preview' })
    expect(readyOf(parent)).toMatchObject({
      capabilities: [
        'overlay',
        'values',
        'stega',
        'pins',
        'links',
        'refresh',
        'scroll-sync',
        'diff-marks',
        'fragment-token',
      ],
      draftRoute: '/api/zap-preview',
    })
  })

  it('spot mode posts zap:spot with the current page URL to the editor that said hello', () => {
    const { parent, deliver } = boot()
    deliver(hello(SESSION, { mode: 'spot' }))
    parent.postMessage.mockClear()
    document
      .querySelector('h1')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(parent.postMessage.mock.calls.map(([m, origin]) => [m.type, m.payload, origin])).toEqual(
      [
        [
          'zap:spot',
          { spot: { x: 0, y: 0 }, viewport: { w: 1, h: 1 }, pageUrl: location.href },
          ZAP,
        ],
      ],
    )
  })

  it.each(['https://evil.example/api', '//evil.example/api', '/a/../b', 'api'])(
    'drops a draft route that is not a plain path (%s): null is announced',
    (draftRoute) => {
      const { parent } = boot({ draftRoute })
      expect(readyOf(parent).draftRoute).toBeNull()
    },
  )

  it('finds a stega-marked text with no tag, and a keystroke rewrites it keeping its marker', () => {
    const marked = stegaEncode('Publicado', { recordRef: 'blog/hola', fieldKey: 'title' })
    const { parent, deliver } = boot({ html: `<h1>${marked}</h1>` })
    deliver(hello())
    const tags = parent.postMessage.mock.calls.map(([m]) => m).filter((m) => m.type === 'zap:tags')
    expect(tags.at(-1)!.payload).toEqual([
      {
        tag: 'blog/hola#title',
        recordRef: 'blog/hola',
        fieldKey: 'title',
        count: 1,
        source: 'stega',
      },
    ])
    deliver(values())
    const h1 = document.querySelector('h1')!
    expect(cleanStega(h1.textContent)).toBe('Borrador')
    expect(h1.textContent).not.toBe('Borrador')
  })

  it('announces every values patch as a window event (`eelzap:values`)', () => {
    const seen = vi.fn()
    window.addEventListener('eelzap:values', seen)
    const { deliver } = boot()
    deliver(hello())
    deliver(values())
    window.removeEventListener('eelzap:values', seen)
    expect(seen).toHaveBeenCalledTimes(1)
    expect((seen.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      recordRef: 'blog/hola',
      locale: 'es',
      patch: { title: 'Borrador' },
    })
  })
})

describe('initZap: a renewed preview token resets the draft cookies in the background', () => {
  const RENEWED = `zpt_${'B'.repeat(43)}`
  const ROUTE = '/api/zap-preview'

  function spyFetch(result: Promise<Response> = Promise.resolve(new Response(null))) {
    return vi.spyOn(window, 'fetch').mockImplementation(() => result)
  }

  it('a hello with a token other than the stored one goes through the draft route, once', () => {
    sessionStorage.setItem(PREVIEW_TOKEN_STORAGE_KEY, TOKEN)
    const fetch = spyFetch()
    const { deliver } = boot({ draftRoute: ROUTE })
    deliver(hello(SESSION, { previewToken: RENEWED }))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(ROUTE)
    expect(String(url)).not.toContain(RENEWED)
    const query = new URLSearchParams(init?.body as URLSearchParams)
    expect([...query.keys()]).toEqual(['token', 'path'])
    expect(query.get('token')).toBe(RENEWED)
    expect(query.get('path')).toBe(location.pathname)
    expect(init).toEqual({
      method: 'POST',
      body: query,
      credentials: 'same-origin',
      redirect: 'manual',
    })
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBe(RENEWED)
  })

  it('a renewal within the same session (a second hello) does the same', () => {
    const fetch = spyFetch()
    const { deliver } = boot({ draftRoute: ROUTE })
    deliver(hello())
    expect(fetch).not.toHaveBeenCalled()
    deliver(hello(SESSION, { previewToken: RENEWED }))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe(ROUTE)
    expect(new URLSearchParams(fetch.mock.calls[0]![1]?.body as URLSearchParams).get('token')).toBe(
      RENEWED,
    )
  })

  it.each([
    ['the first token (nothing stored)', null, TOKEN, ROUTE],
    ['the same token again', TOKEN, TOKEN, ROUTE],
    ['a hello without a token', TOKEN, undefined, ROUTE],
    ['no draft route', TOKEN, RENEWED, undefined],
    ['a draft route that is not a plain path', TOKEN, RENEWED, 'https://evil.example/api'],
  ])('no request for %s', (_name, stored, token, draftRoute) => {
    if (stored) sessionStorage.setItem(PREVIEW_TOKEN_STORAGE_KEY, stored)
    const fetch = spyFetch()
    const { deliver, overlayMounted } = boot({ draftRoute })
    deliver(hello(SESSION, { previewToken: token }))
    expect(overlayMounted()).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a failed request is swallowed: the page carries on with the new token', async () => {
    sessionStorage.setItem(PREVIEW_TOKEN_STORAGE_KEY, TOKEN)
    const failed = Promise.reject(new TypeError('Failed to fetch'))
    const handled = vi.spyOn(failed, 'catch')
    const fetch = spyFetch(failed)
    const { deliver, title } = boot({ draftRoute: ROUTE })
    deliver(hello(SESSION, { previewToken: RENEWED }))
    expect(fetch).toHaveBeenCalledTimes(1)
    // The rejection is handled where it is made, and settles quietly.
    expect(handled).toHaveBeenCalledTimes(1)
    await expect(handled.mock.results[0]!.value).resolves.toBeUndefined()
    expect(sessionStorage.getItem(PREVIEW_TOKEN_STORAGE_KEY)).toBe(RENEWED)
    deliver(values())
    expect(title()).toBe('Borrador')
  })
})
