import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./release', () => ({
  PREVIEW_RELEASE_PATH: '/js/preview/preview.v1.0123456789abcdef.js',
  PREVIEW_RELEASE_INTEGRITY: `sha384-${'A'.repeat(64)}`,
}))

import { bootZapPreview, type ZapBootOptions } from './boot'

/**
 * The boot (zap-cms-v2 §2.7 "What a visitor pays", §7.5 "The boot on public
 * pages"): an ordinary visitor's page makes NO request, adds no element and
 * keeps at most one keydown listener; a preview session loads `./preview`
 * once, the compiled-in path with its SRI hash, from a Zap origin (the framing
 * editor, the configured Zap, or production), never from anything the page or
 * the URL says.
 */

const PATH = '/js/preview/preview.v1.0123456789abcdef.js'
const RELEASE = `https://zap.eel.software${PATH}`
const SITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let fetchSpy: ReturnType<typeof vi.fn>
let xhrOpen: ReturnType<typeof vi.spyOn>
let stops: Array<() => void> = []

/** Every way a page can make a request: a fetch, an XHR, or a new element with a URL. */
function requests() {
  const added = Array.from(document.querySelectorAll('script,link,img,iframe'))
  return { fetch: fetchSpy.mock.calls.length, xhr: xhrOpen.mock.calls.length, added }
}

function boot(options: Partial<ZapBootOptions> = {}, win: Window = window) {
  const stop = bootZapPreview({ siteKey: 'verdeorigen', ...options }, win)
  stops.push(stop)
  return stop
}

/** A window that looks framed, with the parent's origin where the browser exposes it. */
function framedWindow(ancestor: string | null, pageOrigin = window.location.origin): Window {
  const location = Object.create(window.location, {
    ancestorOrigins: {
      value: ancestor === null ? undefined : Object.assign([ancestor], { contains: () => true }),
    },
    search: { value: window.location.search },
    pathname: { value: window.location.pathname },
    origin: { value: pageOrigin },
  })
  return new Proxy(window, {
    get(target, key) {
      if (key === 'parent') return {}
      if (key === 'location') return location
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Window
}

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
const go = (url: string) => window.history.replaceState(null, '', url)

beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open')
  sessionStorage.clear()
  go('/')
})

afterEach(() => {
  for (const stop of stops) stop()
  stops = []
  document.head.querySelectorAll('script').forEach((s) => s.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('outside a preview session: nothing at all', () => {
  it.each([
    ['a plain page', {}],
    ['a plain page, with a site id', { siteId: SITE_ID }],
    ['a page with other query params', { siteId: SITE_ID }, '/?q=zapato&utm_source=zap'],
    ['a site-own OAuth callback', { siteId: SITE_ID }, '/?code=abc&state=theirs'],
    ['Shift pressed twice, the old shortcut', { siteId: SITE_ID }, '/', ['Shift', 'Shift']],
    ['Z without Shift', { siteId: SITE_ID }, '/', ['Z', 'z']],
    ['?zap without a site id', {}, '/?zap'],
  ] as Array<[string, Partial<ZapBootOptions>, string?, string[]?]>)(
    '%s makes no request and adds no element',
    (_name, options, url = '/', keys = []) => {
      go(url)
      boot(options)
      for (const key of keys) press(key)
      expect(requests()).toEqual({ fetch: 0, xhr: 0, added: [] })
    },
  )

  it('a page framed by another site (the browser names the parent) loads nothing', () => {
    boot({ siteId: SITE_ID }, framedWindow('https://evil.example'))
    boot({}, framedWindow('https://zap.eel.software.evil.example'))
    // A local editor counts only for a local page, and only a development host is local.
    boot({}, framedWindow('http://localhost:5047', 'https://verdeorigen.co'))
    boot({}, framedWindow('http://localhost.evil.example', 'http://localhost:3000'))
    expect(requests()).toEqual({ fetch: 0, xhr: 0, added: [] })
  })

  it('without a site key it does nothing even in preview', () => {
    boot({ siteKey: '', preview: true })
    expect(requests().added).toEqual([])
  })
})

describe('in a preview session: the overlay from the compiled-in release, once', () => {
  function loaded(src = RELEASE) {
    const scripts = Array.from(document.head.querySelectorAll('script'))
    expect(scripts).toHaveLength(1)
    const script = scripts[0]!
    expect(script.src).toBe(src)
    expect(script.getAttribute('integrity')).toBe(`sha384-${'A'.repeat(64)}`)
    expect(script.getAttribute('crossorigin')).toBe('anonymous')
    expect(fetchSpy).not.toHaveBeenCalled()
    return script
  }

  it('framed by the production editor', () => {
    const script =
      (boot({ draftRoute: '/api/zap-preview' }, framedWindow('https://zap.eel.software')), loaded())
    expect(script.getAttribute('data-site')).toBe('verdeorigen')
    expect(script.getAttribute('data-zap-draft-route')).toBe('/api/zap-preview')
  })

  it('framed by a local Zap, from a local page: the overlay comes from that Zap', () => {
    boot({}, framedWindow('http://localhost:5047', 'http://localhost:3000'))
    const script = loaded(`http://localhost:5047${PATH}`)
    // The overlay trusts the Zap it came from.
    expect(script.getAttribute('data-zap-origin')).toBe('http://localhost:5047')
  })

  it.each([
    ['an https page, an http Zap', 'http://localhost:5047', 'https://localhost:5070'],
    ['an https page, an https Zap', 'https://localhost:5047', 'https://localhost:5070'],
    ['127.0.0.1', 'http://127.0.0.1:5047', 'http://127.0.0.1:3000'],
    ['*.localhost names', 'https://zap.localhost', 'https://verde.localhost:5070'],
  ])('local development over http or https (%s)', (_label, zap, page) => {
    boot({}, framedWindow(zap, page))
    loaded(`${zap}${PATH}`)
  })

  it('framed by a Zap preview deployment: not an editor, nothing loads', () => {
    const deployment = 'https://eel-zap-web-abc123def-example-team.vercel.app'
    boot({ siteId: SITE_ID }, framedWindow(deployment, 'https://verdeorigen.co'))
    expect(requests()).toEqual({ fetch: 0, xhr: 0, added: [] })
  })

  it('zapOrigin (EELZAP_ORIGIN) names where the overlay loads from, on a local page', () => {
    boot({ preview: true, zapOrigin: 'http://localhost:5047' })
    expect(loaded(`http://localhost:5047${PATH}`).getAttribute('data-zap-origin')).toBe(
      'http://localhost:5047',
    )
  })

  it('a local zapOrigin left in production code is ignored: production serves it', () => {
    boot(
      { preview: true, zapOrigin: 'http://localhost:5047' },
      framedWindow(null, 'https://verdeorigen.co'),
    )
    expect(loaded().getAttribute('data-zap-origin')).toBe('https://zap.eel.software')
  })

  it.each([
    'http://localhost.evil.example',
    'http://evil.example',
    'https://zap.eel.software.evil.example',
  ])('a zapOrigin that is not a Zap origin (%s) is ignored', (zapOrigin) => {
    boot({ preview: true, zapOrigin })
    loaded()
  })

  it('one script per document: StrictMode, a remount, a second boot', () => {
    boot({ preview: true })
    boot({ preview: true })
    boot({}, framedWindow('https://zap.eel.software'))
    loaded()
  })

  it('framed where the browser cannot name the parent (Firefox): the overlay decides', () => {
    boot({}, framedWindow(null))
    loaded()
  })

  it('a draft-mode session the server reported', () => {
    boot({ preview: true })
    loaded()
  })

  it.each(['/?zap', '/?zap=1&x=2'])('suggestion mode asked for with %s', (url) => {
    go(url)
    boot({ siteId: SITE_ID })
    expect(loaded().getAttribute('data-site-id')).toBe(SITE_ID)
  })

  it('the OAuth callback of a sign-in this client started', () => {
    go('/?code=abc&state=zap1.xyz&iss=https://auth.eel.software')
    boot({ siteId: SITE_ID })
    loaded()
  })

  it.each(['eelzap:site-token', 'eelzap:signin'])('a tab holding %s', (key) => {
    sessionStorage.setItem(key, '{}')
    boot({ siteId: SITE_ID })
    loaded()
  })

  it('Shift Z opens the site tools at once', () => {
    boot({ siteId: SITE_ID })
    press('Z', { shiftKey: true })
    expect(loaded().hasAttribute('data-zap-open')).toBe(true)
    press('Z', { shiftKey: true })
    loaded()
  })

  it.each([
    ['an input', '<input id="t">'],
    ['a textarea', '<textarea id="t"></textarea>'],
    ['a select', '<select id="t"><option>a</option></select>'],
    ['a contenteditable element', '<div contenteditable><span id="t">x</span></div>'],
  ])('Shift Z typed in %s makes no request and adds no element', (_label, markup) => {
    document.body.innerHTML = markup
    boot({ siteId: SITE_ID })
    press('Z', { shiftKey: true }, document.getElementById('t')!)
    document.body.innerHTML = ''
    expect(requests()).toEqual({ fetch: 0, xhr: 0, added: [] })
  })

  it('Shift Z inside an IME composition makes no request (isComposing, keyCode 229)', () => {
    boot({ siteId: SITE_ID })
    press('Z', { shiftKey: true, isComposing: true })
    press('Z', { shiftKey: true, keyCode: 229 })
    expect(requests()).toEqual({ fetch: 0, xhr: 0, added: [] })
  })

  it('never loads from a URL the page or the query string names', () => {
    go('/?zap=https://evil.example/x.js&src=https://evil.example/y.js')
    boot({
      siteId: SITE_ID,
      zapOrigin: 'https://evil.example',
      draftRoute: '//evil.example/x',
    } as ZapBootOptions)
    const script = loaded()
    expect(script.src).toBe(RELEASE)
    // The overlay itself refuses a draft route that is not a plain path.
    expect(script.getAttribute('data-zap-draft-route')).toBe('//evil.example/x')
  })
})
