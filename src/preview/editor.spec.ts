import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createEditorBridge,
  createSession,
  draftModeUrl,
  type EditorBridge,
  type EditorBridgeHandlers,
} from './editor'
import { envelope, isSession, MAX_MESSAGE_BYTES, PAGE_UNLOAD_ERROR } from './protocol'

const SESSION = '0123456789abcdef0123456789abcdef'
const OTHER = 'ffffffffffffffffffffffffffffffff'
const SITE = 'https://ejemplo.com'

const ready = (session = SESSION) =>
  envelope('zap:ready', session, {
    version: '0.1.0',
    capabilities: ['overlay', 'values'],
    pageUrl: 'https://ejemplo.com/blog/hola',
  })

const HELLO = {
  siteKey: 'main',
  locale: 'es',
  labels: { title: 'Título' },
  recordRef: 'blog/hola',
  mode: 'inspect' as const,
}

const bridges: EditorBridge[] = []
afterEach(() => {
  while (bridges.length) bridges.pop()!.destroy()
  vi.useRealTimers()
})

function setup(handlers: EditorBridgeHandlers = {}) {
  const frameWindow = { postMessage: vi.fn() }
  const frame = { contentWindow: frameWindow as unknown as Window }
  const bridge = createEditorBridge({
    frame,
    session: SESSION,
    pageOrigins: [SITE],
    handlers,
  })
  bridges.push(bridge)
  const deliver = (data: unknown, init: { origin?: string; source?: unknown } = {}) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        origin: init.origin ?? SITE,
        source: (init.source === undefined ? frameWindow : init.source) as MessageEventSource,
      }),
    )
  const sent = () => frameWindow.postMessage.mock.calls.map(([m, target]) => [m.type, target])
  return { bridge, frameWindow, deliver, sent }
}

describe('createSession', () => {
  it('makes 128-bit hex sessions that differ', () => {
    const a = createSession()
    expect(isSession(a)).toBe(true)
    expect(a).not.toBe(createSession())
  })
})

describe('editor bridge — what it accepts', () => {
  it('accepts ready from the frame, a page origin, before the hello without a session', () => {
    const onReady = vi.fn()
    const { bridge, deliver } = setup({ onReady })
    deliver(ready(''))
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ version: '0.1.0' }), {
      origin: SITE,
    })
    expect(bridge.ready).toBe(true)
  })

  it('drops a message whose source is not the frame', () => {
    const onReady = vi.fn()
    const { bridge, deliver } = setup({ onReady })
    deliver(ready(), { source: window })
    deliver(ready(), { source: { postMessage() {} } })
    expect(onReady).not.toHaveBeenCalled()
    expect(bridge.stats['wrong-source']).toBe(2)
  })

  it('drops anything whose origin is not a page origin, the opaque "null" included', () => {
    const onReady = vi.fn()
    const { bridge, deliver } = setup({ onReady })
    deliver(ready(''), { origin: 'null' })
    deliver(ready(''), { origin: 'https://evil.example' })
    deliver(ready(''), { origin: 'https://zap.eel.software' })
    deliver(ready(''), { origin: `${SITE}.evil.example` })
    deliver(ready(''), { origin: 'http://ejemplo.com' })
    expect(onReady).not.toHaveBeenCalled()
    expect(bridge.ready).toBe(false)
    expect(bridge.stats['wrong-origin']).toBe(5)
  })

  it('drops a wrong session, and an empty one on anything but ready', () => {
    const onReady = vi.fn()
    const onClick = vi.fn()
    const { bridge, deliver } = setup({ onReady, onClick })
    deliver(ready(OTHER))
    expect(onReady).not.toHaveBeenCalled()
    deliver(ready(''))
    expect(onReady).toHaveBeenCalledTimes(1)
    deliver(envelope('zap:click', '', { recordRef: 'blog/hola', fieldKey: 'title' }))
    deliver(envelope('zap:click', OTHER, { recordRef: 'blog/hola', fieldKey: 'title' }))
    expect(onClick).not.toHaveBeenCalled()
    expect(bridge.stats['wrong-session']).toBe(3)
  })

  it('drops oversized payloads and unknown types', () => {
    const onClick = vi.fn()
    const { bridge, deliver } = setup({ onClick })
    deliver(ready())
    deliver(envelope('zap:error', SESSION, { code: 'X', detail: 'x'.repeat(MAX_MESSAGE_BYTES) }))
    deliver(envelope('zap:write', SESSION, {}))
    deliver(envelope('zap:hello', SESSION, {})) // an editor → page type, wrong direction
    deliver(envelope('zap:click', SESSION, { recordRef: 'blog/hola', fieldKey: 'title' }))
    expect(bridge.stats).toMatchObject({ oversize: 1, 'unknown-type': 2 })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('refuses construction without page origins', () => {
    expect(() => createEditorBridge({ frame: { contentWindow: null }, pageOrigins: [] })).toThrow()
    expect(() =>
      createEditorBridge({ frame: { contentWindow: null }, pageOrigins: ['null'] }),
    ).toThrow()
  })
})

describe('editor bridge — what it sends', () => {
  it('waits for ready, sends hello first, then queued messages, to the exact page origin', () => {
    const { bridge, deliver, sent } = setup()
    bridge.setMode('select')
    bridge.hello(HELLO)
    expect(sent()).toEqual([])
    deliver(ready(''))
    expect(sent()).toEqual([
      ['zap:hello', SITE],
      ['zap:mode', SITE],
    ])
  })

  it('every post targets the exact origin that said ready, never "*"', () => {
    vi.useFakeTimers()
    const { bridge, deliver, frameWindow } = setup()
    bridge.hello({ ...HELLO, previewToken: `zpt_${'A'.repeat(43)}` })
    deliver(ready(''))
    bridge.setValues('blog/hola', 'es', { title: 'Hola' })
    vi.runAllTimers()
    bridge.focusField('blog/hola', 'title')
    bridge.setMode('select')
    bridge.setZoom(0.5)
    bridge.highlight([])
    bridge.setPins([{ id: 'a', n: 1, spot: { x: 0.1, y: 0.1 } }])
    const calls = frameWindow.postMessage.mock.calls
    expect(calls.map(([m]) => (m as { type: string }).type)).toEqual([
      'zap:hello',
      'zap:values',
      'zap:focus-field',
      'zap:mode',
      'zap:zoom',
      'zap:highlight',
      'zap:pins',
    ])
    for (const [, target] of calls) {
      expect(target).toBe(SITE)
      expect(target).not.toBe('*')
    }
  })

  it('has no ready timer: nothing fires without ready, however long', () => {
    vi.useFakeTimers()
    const { bridge, frameWindow } = setup()
    bridge.hello(HELLO)
    vi.advanceTimersByTime(60_000)
    expect(bridge.ready).toBe(false)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
  })

  it('debounces values 120 ms: full set first, then only what changed', () => {
    vi.useFakeTimers()
    const { bridge, frameWindow, deliver } = setup()
    deliver(ready())
    bridge.hello(HELLO)
    frameWindow.postMessage.mockClear()

    bridge.setValues('blog/hola', 'es', { title: 'H', subtitle: 'S' })
    bridge.setValues('blog/hola', 'es', { title: 'Ho', subtitle: 'S' })
    vi.advanceTimersByTime(119)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(1)
    expect(frameWindow.postMessage.mock.calls[0]![0].payload).toEqual({
      recordRef: 'blog/hola',
      locale: 'es',
      patch: { title: 'Ho', subtitle: 'S' },
    })

    bridge.setValues('blog/hola', 'es', { title: 'Hol', subtitle: 'S' })
    vi.advanceTimersByTime(120)
    expect(frameWindow.postMessage.mock.calls[1]![0].payload.patch).toEqual({ title: 'Hol' })

    // Nothing changed → nothing sent.
    bridge.setValues('blog/hola', 'es', { title: 'Hol', subtitle: 'S' })
    vi.advanceTimersByTime(120)
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(2)

    // Another locale is a new scope: full set again.
    bridge.setValues('blog/hola', 'en', { title: 'Hol', subtitle: 'S' })
    vi.advanceTimersByTime(120)
    expect(frameWindow.postMessage.mock.calls[2]![0].payload.patch).toEqual({
      title: 'Hol',
      subtitle: 'S',
    })
  })

  it('splits a large full set under the 256 KB cap and drops a field that alone exceeds it', () => {
    const { bridge, frameWindow, deliver } = setup()
    deliver(ready())
    bridge.hello(HELLO)
    frameWindow.postMessage.mockClear()
    const chunk = 'x'.repeat(100 * 1024)
    bridge.setValues('blog/hola', 'es', {
      a: chunk,
      b: chunk,
      c: chunk,
      huge: 'x'.repeat(MAX_MESSAGE_BYTES),
    })
    bridge.flushValues()
    const patches = frameWindow.postMessage.mock.calls.map(([m]) => Object.keys(m.payload.patch))
    expect(patches).toEqual([['a', 'b'], ['c']])
    expect(bridge.stats['oversize-out']).toBe(1)
    for (const [message] of frameWindow.postMessage.mock.calls) {
      expect(new TextEncoder().encode(JSON.stringify(message)).length).toBeLessThanOrEqual(
        MAX_MESSAGE_BYTES,
      )
    }
  })

  it('refuses a malformed session', () => {
    expect(() =>
      createEditorBridge({ frame: { contentWindow: null }, pageOrigins: [SITE], session: 'abc' }),
    ).toThrow()
  })
})

describe('editor bridge — the frame navigating away', () => {
  it('holds everything after PAGE_UNLOAD until the next ready, and still tells the panel', () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const { bridge, deliver, frameWindow } = setup({ onError })
    deliver(ready(''))
    bridge.hello(HELLO)
    bridge.setValues('blog/hola', 'es', { title: 'Borrador 1' })
    vi.runAllTimers()
    const before = frameWindow.postMessage.mock.calls.length
    expect(before).toBeGreaterThan(0)

    deliver(envelope('zap:error', SESSION, { code: PAGE_UNLOAD_ERROR }))
    expect(onError).toHaveBeenCalledWith({ code: PAGE_UNLOAD_ERROR })
    expect(bridge.ready).toBe(false)

    // Nothing reaches the frame until a new document says ready.
    bridge.setValues('blog/hola', 'es', { title: 'Borrador secreto' })
    vi.runAllTimers()
    bridge.flushValues()
    bridge.focusField('blog/hola', 'title')
    bridge.setMode('select')
    expect(frameWindow.postMessage.mock.calls.length).toBe(before)
  })

  it('ignores a PAGE_UNLOAD without the session', () => {
    vi.useFakeTimers()
    const { bridge, deliver, frameWindow } = setup()
    deliver(ready())
    bridge.hello(HELLO)
    deliver(envelope('zap:error', OTHER, { code: PAGE_UNLOAD_ERROR }))
    bridge.setValues('blog/hola', 'es', { title: 'x' })
    vi.runAllTimers()
    expect(frameWindow.postMessage.mock.calls.at(-1)![0].type).toBe('zap:values')
  })
})

describe('editor bridge — every document says hello again', () => {
  const STAGING = 'https://staging.ejemplo.com'

  function live(handlers: EditorBridgeHandlers = {}) {
    const frameWindow = { postMessage: vi.fn() }
    const bridge = createEditorBridge({
      frame: { contentWindow: frameWindow as unknown as Window },
      session: SESSION,
      pageOrigins: [SITE, STAGING],
      handlers,
      debounceMs: 0,
    })
    bridges.push(bridge)
    const deliver = (data: unknown, origin = SITE) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin,
          source: frameWindow as unknown as MessageEventSource,
        }),
      )
    const sent = () =>
      frameWindow.postMessage.mock.calls.map(([m, target]) => [
        (m as { type: string }).type,
        target,
      ])
    return { bridge, frameWindow, deliver, sent }
  }

  it('never posts with "*": always the exact origin that said ready', () => {
    const { bridge, deliver, frameWindow } = live()
    bridge.hello({ ...HELLO, previewToken: `zpt_${'A'.repeat(43)}` })
    deliver(ready(''))
    bridge.focusField('blog/hola', 'title')
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(2)
    for (const [, target] of frameWindow.postMessage.mock.calls) expect(target).toBe(SITE)
  })

  it('a new document re-handshakes: last hello with the current mode, full values again', () => {
    vi.useFakeTimers()
    const onReady = vi.fn()
    const { bridge, deliver, sent, frameWindow } = live({ onReady })
    bridge.hello(HELLO)
    deliver(ready(''))
    bridge.setValues('blog/hola', 'es', { title: 'Hola' })
    vi.advanceTimersByTime(1)
    bridge.setMode('select')
    frameWindow.postMessage.mockClear()

    // The person follows a link; the next page, on staging, says ready.
    deliver(envelope('zap:error', SESSION, { code: PAGE_UNLOAD_ERROR }))
    bridge.focusField('blog/hola', 'title') // held, then dropped with the old document
    deliver(ready(''), STAGING)
    bridge.setValues('blog/hola', 'es', { title: 'Hola' })
    vi.advanceTimersByTime(1)

    expect(onReady).toHaveBeenCalledTimes(2)
    expect(sent()).toEqual([
      ['zap:hello', STAGING],
      ['zap:values', STAGING],
    ])
    const hello = frameWindow.postMessage.mock.calls[0]![0] as { payload: { mode: string } }
    expect(hello.payload.mode).toBe('select')
  })

  it('a message from another preview origin than the pinned one is dropped', () => {
    const onClick = vi.fn()
    const { bridge, deliver } = live({ onClick })
    deliver(ready(''))
    deliver(envelope('zap:click', SESSION, { recordRef: 'blog/hola', fieldKey: 'title' }), STAGING)
    expect(onClick).not.toHaveBeenCalled()
    expect(bridge.stats['wrong-origin']).toBe(1)
  })

  it('a message from the pinned origin with a stale-document origin is dropped after re-pinning', () => {
    const onClick = vi.fn()
    const { deliver, bridge } = live({ onClick })
    deliver(ready(''))
    deliver(ready(''), STAGING)
    deliver(envelope('zap:click', SESSION, { recordRef: 'blog/hola', fieldKey: 'title' }), SITE)
    expect(onClick).not.toHaveBeenCalled()
    expect(bridge.stats['wrong-origin']).toBe(1)
  })
})

/**
 * §2.5, §7.5: the page announces a draft-mode route PATH; the editor joins it
 * to the frame's verified origin only. `onReady` hands the panel that origin.
 */
describe('editor bridge — comment pins and spots', () => {
  const PINS = [
    { id: 'a', n: 1, spot: { x: 0.2, y: 0.4 } },
    { id: 'b', n: 2, spot: { x: 0.5, y: 0.5 } },
  ]
  const SPOT = { spot: { x: 0.2, y: 0.4 }, viewport: { w: 1280, h: 2200 }, pageUrl: SITE + '/' }

  it('sends zap:pins after the hello, once per distinct set', () => {
    const { bridge, deliver, frameWindow } = setup()
    bridge.setPins(PINS) // queued until ready + hello
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
    deliver(ready())
    bridge.hello(HELLO)
    bridge.setPins([...PINS]) // identical: not sent again
    bridge.setPins([PINS[0]!])
    bridge.setPins([])
    const pins = frameWindow.postMessage.mock.calls
      .map(([m]) => m as { type: string; payload: { pins: unknown[] } })
      .filter((m) => m.type === 'zap:pins')
      .map((m) => m.payload.pins)
    expect(pins).toEqual([PINS, [PINS[0]], []])
  })

  it('a new document gets the same pins again when the panel re-sends them', () => {
    const frameWindow = { postMessage: vi.fn() }
    const bridge = createEditorBridge({
      frame: { contentWindow: frameWindow as unknown as Window },
      session: SESSION,
      pageOrigins: [SITE],
    })
    bridges.push(bridge)
    const deliver = (data: unknown) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin: SITE,
          source: frameWindow as unknown as MessageEventSource,
        }),
      )
    bridge.hello(HELLO)
    deliver(ready(''))
    bridge.setPins(PINS)
    deliver(ready('')) // the frame navigated; the new document has no pins
    bridge.setPins(PINS)
    const types = frameWindow.postMessage.mock.calls.map(([m]) => (m as { type: string }).type)
    expect(types.filter((t) => t === 'zap:pins')).toHaveLength(2)
  })

  it('hands zap:spot and zap:pin to the panel, and drops invalid ones', () => {
    const onSpot = vi.fn()
    const onPin = vi.fn()
    const { bridge, deliver } = setup({ onSpot, onPin })
    deliver(ready())
    deliver(envelope('zap:spot', SESSION, SPOT))
    deliver(envelope('zap:pin', SESSION, { id: 'b' }))
    deliver(envelope('zap:spot', SESSION, { ...SPOT, spot: { x: 2, y: 0 } }))
    deliver(envelope('zap:spot', SESSION, { ...SPOT, pageUrl: 'javascript:alert(1)' }))
    deliver(envelope('zap:pin', SESSION, { id: '<script>' }))
    deliver(envelope('zap:pin', OTHER, { id: 'b' }))
    expect(onSpot.mock.calls).toEqual([[SPOT]])
    expect(onPin.mock.calls).toEqual([[{ id: 'b' }]])
    expect(bridge.stats).toMatchObject({ 'invalid-payload': 3, 'wrong-session': 1 })
  })
})

describe('draft-mode route: joined to the verified origin only', () => {
  const TOKEN = `zpt_${'A'.repeat(43)}`

  it('onReady gives the verified origin beside the payload', () => {
    const onReady = vi.fn()
    const { deliver } = setup({ onReady })
    deliver(
      envelope('zap:ready', '', {
        version: '0.10.0',
        capabilities: ['overlay', 'values', 'stega'],
        pageUrl: `${SITE}/blog/x`,
        draftRoute: '/api/zap-preview',
      }),
    )
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ draftRoute: '/api/zap-preview' }),
      { origin: SITE },
    )
  })

  it('a ready whose route carries a host never reaches the panel', () => {
    const onReady = vi.fn()
    const { deliver, bridge } = setup({ onReady })
    deliver(
      envelope('zap:ready', '', {
        version: '0.10.0',
        capabilities: [],
        pageUrl: `${SITE}/`,
        draftRoute: '//evil.example/steal',
      }),
    )
    expect(onReady).not.toHaveBeenCalled()
    expect(bridge.stats['invalid-payload']).toBe(1)
  })

  it('builds {origin}{route}?token&path', () => {
    expect(
      draftModeUrl({
        origin: SITE,
        draftRoute: '/api/zap-preview',
        token: TOKEN,
        path: '/blog/x?a=1',
      }),
    ).toBe(`${SITE}/api/zap-preview?token=${TOKEN}&path=%2Fblog%2Fx%3Fa%3D1`)
  })

  it.each([
    ['a route with a host', { draftRoute: '//evil.example/x' }],
    ['an absolute route', { draftRoute: 'https://evil.example/x' }],
    ['a backslash route', { draftRoute: '/\\evil.example' }],
    ['a dot-segment route', { draftRoute: '/a/../../x' }],
    ['no route', { draftRoute: null }],
    ['an opaque origin', { origin: 'null' }],
    ['an origin with a path', { origin: `${SITE}/x` }],
    ['a non-http origin', { origin: 'javascript:alert(1)' }],
    ['a malformed token', { token: 'secret_abc' }],
    ['a protocol-relative page path', { path: '//evil.example/' }],
    ['a relative page path', { path: 'blog/x' }],
  ] as const)('refuses %s', (_name, override) => {
    expect(
      draftModeUrl({
        origin: SITE,
        draftRoute: '/api/zap-preview',
        token: TOKEN,
        path: '/blog/x',
        ...override,
      } as Parameters<typeof draftModeUrl>[0]),
    ).toBeNull()
  })
})
