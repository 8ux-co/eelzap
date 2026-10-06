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
})

/** The runtime as the Live client starts it (`live.ts`): no session until the hello. */
function boot(html: string) {
  document.body.innerHTML = html
  const parent = { postMessage: vi.fn() }
  let pageUrl = PAGE_URL
  const runtime = startRuntime(
    {
      editorOrigins: [ZAP],
      pageUrl: () => pageUrl,
      lazyOverlay: true,
    },
    { win: window, doc: document, parent, throttleMs: 0 },
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
  const hello = (mode: 'inspect' | 'select' | 'off' = 'inspect') =>
    deliver('zap:hello', {
      session: SESSION,
      siteKey: 'main',
      locale: 'es',
      labels: { title: 'Título' },
      recordRef: 'blog/hola',
      mode,
      zoom: 0.5,
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
        capabilities: ['overlay', 'values', 'stega', 'pins', 'links'],
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

    document.querySelector('h1')!.scrollIntoView = vi.fn()
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
    document.querySelector('#free')!.scrollIntoView = vi.fn()
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
})
