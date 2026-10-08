import { afterEach, describe, expect, it, vi } from 'vitest'

import { envelope } from './protocol'
import { startRuntime, type PageRuntime } from './runtime'

const ZAP = 'https://zap.eel.software'
const SESSION = '0123456789abcdef0123456789abcdef'
const PAGE_URL = 'https://ejemplo.com/blog/hola'

const runtimes: PageRuntime[] = []
afterEach(() => {
  while (runtimes.length) runtimes.pop()!.destroy()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

/**
 * The real window, with `location` swapped for a fake (jsdom's own cannot be
 * spied on); everything else reaches the real one.
 */
function windowWithLocation(location: Partial<Location>): Window {
  return new Proxy(window, {
    get(target, key) {
      if (key === 'location') return location
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** The runtime as the Live client starts it (`live.ts`): no session until the hello. */
function boot(html: string, win: Window = window) {
  document.body.innerHTML = html
  const parent = { postMessage: vi.fn() }
  let pageUrl = PAGE_URL
  const runtime = startRuntime(
    {
      editorOrigins: [ZAP],
      pageUrl: () => pageUrl,
      lazyOverlay: true,
    },
    { win, doc: document, parent, throttleMs: 0 },
  )
  runtimes.push(runtime)
  const deliver = (type: string, payload: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: envelope(type, SESSION, payload),
        origin: ZAP,
        source: parent as unknown as MessageEventSource,
      }),
    )
  const posted = () =>
    parent.postMessage.mock.calls.map(([message, target]) => {
      expect(target).toBe(ZAP)
      return message as { type: string; payload: unknown; session: string }
    })
  const hello = (mode: 'inspect' | 'select' | 'off' = 'inspect', extra: object = {}) =>
    deliver('zap:hello', {
      session: SESSION,
      siteKey: 'main',
      locale: 'es',
      labels: { title: 'Título' },
      recordRef: 'blog/hola',
      mode,
      zoom: 0.5,
      ...extra,
    })
  const moveTo = (url: string) => {
    pageUrl = url
  }
  return { runtime, parent, deliver, posted, hello, moveTo }
}

const PAGE = `
  <main>
    <h1 data-zap="blog/hola#title">Hola</h1>
    <div data-zap="blog/hola#body" data-zap-html><p>Cuerpo</p></div>
    <p id="free">Texto libre</p>
    <span data-zap="Bad#tag">x</span>
  </main>
`

describe('page runtime', () => {
  it('announces ready, the tags and invalid tags on boot, before any session', () => {
    const { posted } = boot(PAGE)
    const messages = posted()
    expect(messages.map((m) => m.type)).toEqual(['zap:ready', 'zap:tags', 'zap:error'])
    expect(messages[0]).toMatchObject({
      session: '',
      payload: {
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
        pageUrl: PAGE_URL,
        draftRoute: null,
      },
    })
    expect(messages[1]!.payload).toEqual([
      { tag: 'blog/hola#body', recordRef: 'blog/hola', fieldKey: 'body', count: 1, source: 'attr' },
      {
        tag: 'blog/hola#title',
        recordRef: 'blog/hola',
        fieldKey: 'title',
        count: 1,
        source: 'attr',
      },
    ])
    expect(messages[2]!.payload).toEqual({ code: 'TAG_INVALID', detail: 'data-zap=Bad#tag' })
  })

  it('adds nothing to the page before the hello, and answers the hello with the tags', () => {
    const { runtime, posted, hello } = boot(PAGE)
    expect(runtime.overlay.hostElement).toBeFalsy()
    hello()
    expect(runtime.overlay.hostElement).toBeTruthy()
    expect(runtime.bridge.session).toBe(SESSION)
    expect(posted().at(-1)).toMatchObject({ type: 'zap:tags', session: SESSION })
  })

  it('substitutes values, outlines a focused field, and answers a click with zap:click', () => {
    const { runtime, posted, deliver, hello } = boot(PAGE)
    hello('inspect')
    deliver('zap:values', {
      recordRef: 'blog/hola',
      locale: 'es',
      patch: { title: 'Nuevo título', body: { html: '<p>Nuevo <script>x()</script>cuerpo</p>' } },
    })
    expect(document.querySelector('h1')!.textContent).toBe('Nuevo título')
    expect(document.querySelector('[data-zap-html]')!.innerHTML).toBe('<p>Nuevo cuerpo</p>')

    deliver('zap:focus-field', { recordRef: 'blog/hola', fieldKey: 'title' })
    runtime.overlay.render()
    expect(runtime.overlay.inspect().boxes.map((b) => b.kind)).toEqual(['focus'])
    expect(runtime.overlay.inspect().zoom).toBe(0.5)

    document
      .querySelector('h1')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(posted().at(-1)).toMatchObject({
      type: 'zap:click',
      session: SESSION,
      payload: { recordRef: 'blog/hola', fieldKey: 'title' },
    })
  })

  it('select mode: two elements become one zap:select with two anchors', () => {
    const { posted, deliver, hello } = boot(PAGE)
    hello('inspect')
    deliver('zap:mode', 'select')
    document
      .querySelector('h1')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    document
      .querySelector('#free')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
    const last = posted().at(-1)!
    expect(last.type).toBe('zap:select')
    const anchors = (last.payload as { anchors: Array<Record<string, unknown>> }).anchors
    expect(anchors).toHaveLength(2)
    expect(anchors[0]).toMatchObject({
      field: { recordRef: 'blog/hola', key: 'title', locale: null },
      dom: { tag: 'blog/hola#title', textQuote: { exact: 'Hola' } },
      pageUrl: PAGE_URL,
    })
    expect(anchors[1]).toMatchObject({
      field: null,
      dom: { tag: null, selector: '#free', textQuote: { exact: 'Texto libre' } },
    })
  })

  it('select mode: a click on the page itself is a zap:spot (one comment toggle in Zap)', () => {
    const { posted, deliver, hello } = boot(PAGE)
    hello('inspect')
    deliver('zap:mode', 'select')
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const last = posted().at(-1)!
    expect(last.type).toBe('zap:spot')
    expect(last.payload).toMatchObject({ pageUrl: PAGE_URL, spot: { x: 0, y: 0 } })
  })

  it('tells the editor on pagehide that this document is going away', () => {
    const { posted, hello } = boot(PAGE)
    hello()
    window.dispatchEvent(new Event('pagehide'))
    expect(posted().at(-1)).toMatchObject({
      type: 'zap:error',
      session: SESSION,
      payload: { code: 'PAGE_UNLOAD' },
    })
  })

  it('reports new tags after a mutation, and re-applies values to re-rendered nodes', () => {
    const { runtime, posted, deliver, hello } = boot(PAGE)
    hello()
    deliver('zap:values', { recordRef: 'blog/hola', locale: 'es', patch: { title: 'Nuevo' } })
    document
      .querySelector('main')!
      .insertAdjacentHTML('beforeend', '<h2 data-zap="blog/hola#title">Hola</h2>')
    runtime.refresh()
    expect(document.querySelector('h2')!.textContent).toBe('Nuevo')
    const tags = posted()
      .filter((m) => m.type === 'zap:tags')
      .at(-1)!
    expect(tags.payload).toContainEqual({
      tag: 'blog/hola#title',
      recordRef: 'blog/hola',
      fieldKey: 'title',
      count: 2,
      source: 'attr',
    })
  })

  it('a client-side URL change posts zap:navigate once, with the new URL', () => {
    const { runtime, posted, hello, moveTo } = boot(PAGE)
    hello()
    runtime.refresh()
    expect(posted().some((m) => m.type === 'zap:navigate')).toBe(false)
    moveTo('https://ejemplo.com/blog/otra')
    runtime.refresh()
    runtime.refresh()
    const navigations = posted().filter((m) => m.type === 'zap:navigate')
    expect(navigations).toEqual([
      expect.objectContaining({
        session: SESSION,
        payload: { url: 'https://ejemplo.com/blog/otra' },
      }),
    ])
  })

  it('highlights change-request anchors, surviving a hostile selector', () => {
    const { runtime, deliver, hello } = boot(PAGE)
    hello()
    deliver('zap:highlight', {
      anchors: [
        {
          tag: null,
          selector: 'p:has(',
          textQuote: { exact: 'Texto libre', prefix: '', suffix: '' },
          rect: { x: 0, y: 0, w: 0, h: 0 },
          viewport: { w: 1280, h: 2000 },
        },
      ],
    })
    runtime.overlay.render()
    expect(runtime.overlay.inspect().boxes.map((b) => b.kind)).toEqual(['highlight'])
  })

  it('draws zap:pins (a dom pin whose element is gone is skipped) and reports spot and pin clicks', () => {
    const { runtime, deliver, hello, posted } = boot(PAGE)
    hello()
    deliver('zap:mode', 'spot')
    const dom = (selector: string) => ({
      tag: null,
      selector,
      textQuote: null,
      rect: { x: 0, y: 0, w: 0, h: 0 },
      viewport: { w: 1280, h: 2000 },
    })
    deliver('zap:pins', {
      pins: [
        { id: 'a', n: 1, spot: { x: 0.5, y: 0.5 } },
        { id: 'b', n: 2, dom: dom('#free') },
        { id: 'c', n: 3, dom: dom('#nowhere') },
      ],
    })
    runtime.overlay.render()
    const pins = runtime.overlay.inspect().pins
    expect(pins.map((p) => p.textContent)).toEqual(['1', '2'])

    pins[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    document
      .querySelector('#free')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }),
      )
    const sent = posted().filter((m) => m.type === 'zap:pin' || m.type === 'zap:spot')
    expect(sent.map((m) => [m.type, m.payload])).toEqual([
      ['zap:pin', { id: 'b' }],
      ['zap:spot', { spot: { x: 0, y: 0 }, viewport: { w: 1, h: 1 }, pageUrl: PAGE_URL }],
    ])
    // A list that fails validation is dropped whole: the pins drawn stay.
    deliver('zap:pins', { pins: [{ id: 'x y', n: 1, spot: { x: 0, y: 0 } }] })
    expect(runtime.bridge.stats['invalid-payload']).toBe(1)
  })

  it('ignores everything from a window other than the parent', () => {
    const { runtime, hello } = boot(PAGE)
    window.dispatchEvent(
      new MessageEvent('message', {
        data: envelope('zap:mode', SESSION, 'select'),
        origin: ZAP,
        source: window as unknown as MessageEventSource,
      }),
    )
    hello('off')
    expect(runtime.overlay.getMode()).toBe('off')
    expect(runtime.bridge.stats['wrong-source']).toBe(1)
  })

  it('says ready again at 500 ms, 1.5 s and 4 s until a hello comes, and never after it', () => {
    vi.useFakeTimers()
    const readies = (posted: () => Array<{ type: string }>) =>
      posted().filter((m) => m.type === 'zap:ready').length
    const late = boot(PAGE)
    expect(readies(late.posted)).toBe(1)
    vi.advanceTimersByTime(499)
    expect(readies(late.posted)).toBe(1)
    vi.advanceTimersByTime(1)
    expect(readies(late.posted)).toBe(2)
    vi.advanceTimersByTime(1000)
    expect(readies(late.posted)).toBe(3)
    vi.advanceTimersByTime(2500)
    expect(readies(late.posted)).toBe(4)
    vi.advanceTimersByTime(60_000)
    expect(readies(late.posted)).toBe(4)
    late.runtime.destroy()

    // A hello before the first retry: the ready is never said again.
    const { posted, hello } = boot(PAGE)
    hello()
    vi.advanceTimersByTime(60_000)
    expect(readies(posted)).toBe(1)
  })

  it('a hello between the retries stops the ones left', () => {
    vi.useFakeTimers()
    const { posted, hello } = boot(PAGE)
    vi.advanceTimersByTime(600)
    hello()
    vi.advanceTimersByTime(60_000)
    expect(posted().filter((m) => m.type === 'zap:ready')).toHaveLength(2)
  })

  it('destroy cancels the pending ready retries: nothing is said after it', () => {
    vi.useFakeTimers()
    const { posted, runtime } = boot(PAGE)
    runtime.destroy()
    vi.advanceTimersByTime(60_000)
    expect(posted().filter((m) => m.type === 'zap:ready')).toHaveLength(1)
  })

  it('a page restored from the back-forward cache says ready again; a fresh pageshow does not', () => {
    const { posted, hello } = boot(PAGE)
    hello()
    const readies = () => posted().filter((m) => m.type === 'zap:ready')
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    expect(readies()).toHaveLength(1)
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(readies()).toHaveLength(2)
    expect(readies()[1]!.payload).toMatchObject({ pageUrl: PAGE_URL })
  })

  it("logs each tags report and its cause with localStorage['eelzap:debug'] set", () => {
    localStorage.setItem('eelzap:debug', '1')
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { hello } = boot(PAGE)
    hello()
    const tagLogs = debug.mock.calls.filter(([prefix, what]) => {
      expect(prefix).toBe('[zap:fields]')
      return what === 'tags'
    })
    expect(tagLogs.map((call) => call[2])).toEqual(['ready', 'hello'])
    expect(tagLogs[0]).toEqual(['[zap:fields]', 'tags', 'ready', 2, PAGE_URL, null])
    expect(tagLogs[1]).toEqual(['[zap:fields]', 'tags', 'hello', 2, PAGE_URL, SESSION])
  })

  it('logs nothing without the debug key', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { hello, deliver } = boot(PAGE)
    hello()
    deliver('zap:values', { recordRef: 'blog/hola', locale: 'es', patch: { title: 'Nuevo' } })
    expect(debug).not.toHaveBeenCalled()
  })

  it('zap:refresh from the editor reloads the page in place', () => {
    const reload = vi.fn()
    const { deliver, hello } = boot(PAGE, windowWithLocation({ href: PAGE_URL, reload }))
    hello()
    expect(reload).not.toHaveBeenCalled()
    deliver('zap:refresh', {})
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("zap:click carries the clicked element's box in the frame's viewport", () => {
    const { posted, hello } = boot(PAGE)
    hello('inspect')
    const h1 = document.querySelector('h1')!
    vi.spyOn(h1, 'getBoundingClientRect').mockReturnValue({
      x: 12,
      y: 340,
      left: 12,
      top: 340,
      right: 312,
      bottom: 380,
      width: 300,
      height: 40,
    } as DOMRect)
    h1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(posted().at(-1)).toMatchObject({
      type: 'zap:click',
      payload: {
        recordRef: 'blog/hola',
        fieldKey: 'title',
        rect: { x: 12, y: 340, w: 300, h: 40 },
      },
    })
  })

  it("the hello's foreign labels reach the overlay: a field of another record names its record", () => {
    const foreign = { 'doc:configuracion#boletin_titulo': ['Título', 'en Configuración'] }
    const { runtime, hello } = boot(
      `${PAGE}<p id="news" data-zap="doc:configuracion#boletin_titulo">Boletín</p>`,
    )
    const setLabels = vi.spyOn(runtime.overlay, 'setLabels')
    hello('inspect', { foreign })
    expect(setLabels).toHaveBeenCalledWith({ title: 'Título' }, foreign)
    document.querySelector('#news')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    runtime.overlay.render()
    expect(runtime.overlay.inspect().boxes).toEqual([
      { kind: 'hover', label: 'Títuloen Configuración' },
    ])
  })
})

describe('page runtime — Comparar (#953)', () => {
  /** The real window, its scroll position and `scrollTo` faked (jsdom does not scroll). */
  function scrollingWindow() {
    const state = { scrollX: 0, scrollY: 0 }
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      state.scrollY = options.top ?? state.scrollY
      window.dispatchEvent(new Event('scroll'))
    })
    const win = new Proxy(window, {
      get(target, key) {
        if (key === 'scrollY' || key === 'scrollX') return state[key]
        if (key === 'scrollTo') return scrollTo
        if (key === 'requestAnimationFrame') return undefined
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    return { win, state, scrollTo }
  }
  const ofType = (messages: Array<{ type: string; payload: unknown }>, type: string) =>
    messages.filter((m) => m.type === type).map((m) => m.payload)

  it('reports scrolls only while the editor has sync on', () => {
    vi.useFakeTimers()
    const { win, state } = scrollingWindow()
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2768)
    const { posted, deliver, hello } = boot(PAGE, win)
    hello('off')
    state.scrollY = 500
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(16)
    expect(ofType(posted(), 'zap:scroll')).toEqual([])

    deliver('zap:scroll-sync', { enabled: true })
    state.scrollY = 1000
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(16)
    expect(ofType(posted(), 'zap:scroll')).toEqual([{ y: 0.25 }, { y: 0.5 }])
    expect(posted().at(-1)).toMatchObject({ type: 'zap:scroll', session: SESSION })

    deliver('zap:scroll-sync', { enabled: false })
    state.scrollY = 0
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(16)
    expect(ofType(posted(), 'zap:scroll')).toHaveLength(2)
  })

  it('applies zap:scroll-to and never echoes it as a scroll', () => {
    vi.useFakeTimers()
    const { win, scrollTo } = scrollingWindow()
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2768)
    const { posted, deliver, hello } = boot(PAGE, win)
    hello('off')
    deliver('zap:scroll-sync', { enabled: true })
    deliver('zap:scroll-to', { y: 0.75 })
    vi.advanceTimersByTime(100)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1500, left: 0, behavior: 'instant' })
    expect(ofType(posted(), 'zap:scroll')).toEqual([{ y: 0 }])
  })

  it('draws zap:marks on every element of each field, again after a rescan; [] clears', () => {
    const { runtime, deliver, hello } = boot(PAGE)
    hello('off')
    deliver('zap:marks', {
      marks: [
        { recordRef: 'blog/hola', fieldKey: 'title', tone: 'added', label: 'Título', active: true },
        { recordRef: 'blog/hola', fieldKey: 'body', tone: 'added', label: 'Cuerpo' },
        { recordRef: 'blog/hola', fieldKey: 'missing', tone: 'added', label: 'Nada' },
      ],
    })
    runtime.overlay.render()
    expect(runtime.overlay.inspect().boxes).toEqual([
      { kind: 'mark', label: '+Título', tone: 'added' },
      { kind: 'mark', label: null, tone: 'added' },
    ])

    document
      .querySelector('main')!
      .insertAdjacentHTML('beforeend', '<h2 data-zap="blog/hola#title">Hola</h2>')
    runtime.refresh()
    runtime.overlay.render()
    expect(runtime.overlay.inspect().boxes.map((b) => b.label)).toEqual([
      '+Título',
      '+Título',
      null,
    ])

    deliver('zap:marks', { marks: [] })
    runtime.overlay.render()
    expect(runtime.overlay.inspect().boxes).toEqual([])
  })
})
