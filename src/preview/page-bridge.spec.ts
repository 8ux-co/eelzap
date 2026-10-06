import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPageBridge, type PageBridge } from './page-bridge'
import { envelope, MAX_MESSAGE_BYTES } from './protocol'

const ZAP = 'https://zap.eel.software'
const SESSION = '0123456789abcdef0123456789abcdef'
const OTHER = 'ffffffffffffffffffffffffffffffff'

const hello = (session = SESSION) =>
  envelope('zap:hello', session, {
    session,
    siteKey: 'main',
    locale: 'es',
    labels: {},
    recordRef: 'blog/hola',
    mode: 'inspect',
  })

const bridges: PageBridge[] = []
afterEach(() => {
  while (bridges.length) bridges.pop()!.destroy()
})

function setup() {
  const parent = { postMessage: vi.fn() }
  const onMessage = vi.fn()
  const bridge = createPageBridge({
    win: window,
    parent,
    editorOrigins: [ZAP],
    onMessage,
  })
  bridges.push(bridge)
  const deliver = (data: unknown, init: { origin?: string; source?: unknown } = {}) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        origin: init.origin ?? ZAP,
        source: (init.source === undefined ? parent : init.source) as MessageEventSource,
      }),
    )
  return { parent, onMessage, bridge, deliver }
}

describe('page bridge — what it accepts', () => {
  it('accepts a hello from the parent on the Zap origin, then session-bound messages', () => {
    const { onMessage, deliver } = setup()
    deliver(hello())
    deliver(envelope('zap:mode', SESSION, 'select'))
    expect(onMessage.mock.calls.map(([m]) => m.type)).toEqual(['zap:hello', 'zap:mode'])
  })

  it('drops a message from any window but the parent', () => {
    const { onMessage, bridge, deliver } = setup()
    deliver(hello(), { source: window }) // the page posting to itself (a site script)
    deliver(hello(), { source: { postMessage() {} } }) // another frame
    deliver(hello(), { source: null })
    expect(onMessage).not.toHaveBeenCalled()
    expect(bridge.stats['wrong-source']).toBe(3)
  })

  it('drops a message from the parent on another origin', () => {
    const { onMessage, bridge, deliver } = setup()
    for (const origin of [
      'https://evil.example',
      'null',
      'https://zap.eel.software.evil.example',
      'http://zap.eel.software',
    ]) {
      deliver(hello(), { origin })
    }
    expect(onMessage).not.toHaveBeenCalled()
    expect(bridge.stats['wrong-origin']).toBe(4)
  })

  it('drops anything but a hello before the hello', () => {
    const { onMessage, bridge, deliver } = setup()
    deliver(envelope('zap:mode', SESSION, 'select'))
    expect(onMessage).not.toHaveBeenCalled()
    expect(bridge.stats['wrong-session']).toBe(1)
  })

  it('drops a message with another session after the hello', () => {
    const { onMessage, bridge, deliver } = setup()
    deliver(hello())
    deliver(envelope('zap:mode', OTHER, 'select'))
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(bridge.stats['wrong-session']).toBe(1)
  })

  it('the first hello fixes the session, a second session is refused', () => {
    const { onMessage, bridge, deliver } = setup()
    expect(bridge.session).toBeNull()
    deliver(hello(OTHER))
    deliver(hello(SESSION))
    deliver(envelope('zap:mode', OTHER, 'off'))
    expect(onMessage.mock.calls.map(([m]) => [m.type, m.session])).toEqual([
      ['zap:hello', OTHER],
      ['zap:mode', OTHER],
    ])
    expect(bridge.session).toBe(OTHER)
    expect(bridge.stats['wrong-session']).toBe(1)
  })

  it('drops a hello whose payload session disagrees with the envelope', () => {
    const { onMessage, bridge, deliver } = setup()
    const forged = hello()
    forged.payload.session = OTHER
    deliver(forged)
    expect(onMessage).not.toHaveBeenCalled()
    expect(bridge.stats['invalid-payload']).toBe(1)
  })

  it('drops oversized payloads and unknown types, and counts them', () => {
    const { onMessage, bridge, deliver } = setup()
    deliver(hello())
    deliver(
      envelope('zap:values', SESSION, {
        recordRef: 'blog/hola',
        locale: 'es',
        patch: { body: 'x'.repeat(MAX_MESSAGE_BYTES) },
      }),
    )
    deliver(envelope('zap:exec', SESSION, { code: 'alert(1)' }))
    deliver({ hello: 'not ours' })
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(bridge.stats).toMatchObject({ oversize: 1, 'unknown-type': 1, 'not-envelope': 1 })
  })
})

describe('page bridge — what it posts', () => {
  it('posts to the exact Zap origin, never "*", with the session once the hello fixed it', () => {
    const { parent, bridge, deliver } = setup()
    bridge.post('zap:ready', { version: '1', capabilities: [], pageUrl: 'https://a.example/' })
    deliver(hello())
    bridge.post('zap:click', { recordRef: 'blog/hola', fieldKey: 'title' })
    expect(parent.postMessage).toHaveBeenCalledTimes(2)
    const calls = parent.postMessage.mock.calls
    for (const [message, target] of calls) {
      expect(target).toBe(ZAP)
      expect(message).toMatchObject({ source: 'eel-zap', v: 1 })
    }
    expect(calls[0]![0]).toMatchObject({ type: 'zap:ready', session: '' })
    expect(calls[1]![0]).toMatchObject({ type: 'zap:click', session: SESSION })
  })

  it('refuses to post an oversized message', () => {
    const { parent, bridge } = setup()
    const ok = bridge.post('zap:error', { code: 'X', detail: 'x'.repeat(10) })
    expect(ok).toBe(true)
    const tags = Array.from({ length: 2000 }, (_, i) => ({
      tag: `blog/${'a'.repeat(200)}${i}#f`,
      recordRef: `blog/${'a'.repeat(200)}${i}`,
      fieldKey: 'f',
      count: 1,
    }))
    expect(bridge.post('zap:tags', tags)).toBe(false)
    expect(parent.postMessage).toHaveBeenCalledTimes(1)
  })
})

describe('page bridge — pre-hello targets', () => {
  const LOCAL_ZAP = 'http://localhost:5047'

  function live(hint: string | null) {
    const parent = { postMessage: vi.fn() }
    const onMessage = vi.fn()
    const bridge = createPageBridge({
      win: window,
      parent,
      editorOrigins: [ZAP, LOCAL_ZAP],
      preHelloTargets: () => (hint ? [hint] : [ZAP]),
      onMessage,
    })
    bridges.push(bridge)
    const deliver = (data: unknown, origin: string) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin,
          source: parent as unknown as MessageEventSource,
        }),
      )
    return { parent, onMessage, bridge, deliver }
  }

  it('posts to the hinted editor alone, and answers it alone after the hello', () => {
    const { parent, onMessage, bridge, deliver } = live(LOCAL_ZAP)
    bridge.post('zap:ready', { version: '1', capabilities: [], pageUrl: 'https://a.example/' })
    deliver(hello(), LOCAL_ZAP)
    bridge.post('zap:click', { recordRef: 'blog/hola', fieldKey: 'title' })
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(parent.postMessage.mock.calls.map(([, target]) => target)).toEqual([
      LOCAL_ZAP,
      LOCAL_ZAP,
    ])
  })

  it('never posts to a pre-hello target it would not accept, nor accepts "null"', () => {
    const { parent, bridge, deliver } = live('https://evil.example')
    bridge.post('zap:ready', { version: '1', capabilities: [], pageUrl: 'https://a.example/' })
    expect(parent.postMessage).not.toHaveBeenCalled()
    deliver(hello(), 'null')
    expect(bridge.stats['wrong-origin']).toBe(1)
  })
})
