import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEditorBridge, type EditorBridge } from './editor'
import { envelope } from './protocol'

/** `bridge.refresh()` (`refresh` capability); helpers copied from `editor.spec.ts`. */

const SESSION = '0123456789abcdef0123456789abcdef'
const SITE = 'https://ejemplo.com'

const ready = (session = SESSION) =>
  envelope('zap:ready', session, {
    version: '0.1.0',
    capabilities: ['overlay', 'values', 'refresh'],
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
})

function setup() {
  const frameWindow = { postMessage: vi.fn() }
  const frame = { contentWindow: frameWindow as unknown as Window }
  const bridge = createEditorBridge({ frame, session: SESSION, pageOrigins: [SITE], handlers: {} })
  bridges.push(bridge)
  const deliver = (data: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        origin: SITE,
        source: frameWindow as unknown as MessageEventSource,
      }),
    )
  const sent = () =>
    frameWindow.postMessage.mock.calls.map(([m, target]) => {
      const message = m as { type: string; session: string; payload: unknown }
      return [message.type, message.payload, message.session, target]
    })
  return { bridge, deliver, sent }
}

describe('editor bridge — refresh', () => {
  it('posts zap:refresh with an empty payload once ready and greeted', () => {
    const { bridge, deliver, sent } = setup()
    bridge.hello(HELLO)
    deliver(ready(''))
    bridge.refresh()
    expect(sent().at(-1)).toEqual(['zap:refresh', {}, SESSION, SITE])
    expect(sent().filter(([type]) => type === 'zap:refresh')).toHaveLength(1)
  })

  it('is held until ready and the hello, then follows the hello', () => {
    const { bridge, deliver, sent } = setup()
    bridge.refresh()
    expect(sent()).toEqual([])
    deliver(ready(''))
    // Ready but no hello yet: still held.
    bridge.refresh()
    expect(sent()).toEqual([])
    bridge.hello(HELLO)
    expect(sent().map(([type]) => type)).toEqual(['zap:hello', 'zap:refresh', 'zap:refresh'])
    expect(sent()[1]).toEqual(['zap:refresh', {}, SESSION, SITE])
  })
})
