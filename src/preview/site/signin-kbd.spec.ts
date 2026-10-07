import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Node's BroadcastChannel reaches every worker thread of the run: this file's own channel.
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  SIGNIN_CHANNEL: 'eel-zap-signin-kbd-spec',
}))

import { NEST_PRODUCTION_ORIGIN, type SiteContext } from './config'
import { start } from './signin'
import { captureShadowRoots } from './spec-helpers'

/**
 * The launcher's «Pulsa Shift Z para editar o comentar» hint draws the
 * shortcut with the shared key caps (`kbd` in `ui.ts`): Shift and Z, two
 * caps in one `.kbd-group`, styled by the Kbd rule.
 */

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let shadows: ReturnType<typeof captureShadowRoots>
let handle: { destroy(): void } | null = null

function context(): SiteContext {
  const win = {
    open: vi.fn(() => null),
    location: {
      origin: 'https://ejemplo.com',
      pathname: '/blog/hola',
      search: '',
      hash: '',
      assign: vi.fn(),
      replace: vi.fn(),
    },
    crypto: window.crypto,
    sessionStorage: window.sessionStorage,
    fetch: vi.fn(),
  } as unknown as Window
  return {
    win,
    doc: document,
    siteId: SITE,
    zapOrigin: 'https://zap.eel.software',
    authOrigin: NEST_PRODUCTION_ORIGIN,
    clientId: `https://zap.eel.software/oauth/clients/${SITE}.json`,
    redirectUri: 'https://ejemplo.com/',
    locale: 'es',
    shortcut: 'z',
    open: vi.fn(async () => {}),
    close: vi.fn(),
  }
}

beforeEach(() => {
  sessionStorage.clear()
  shadows = captureShadowRoots()
})
afterEach(() => {
  handle?.destroy()
  handle = null
  vi.restoreAllMocks()
})

describe('the launcher hint key caps', () => {
  it('Shift and Z are two <kbd> in one .kbd-group, the key upper-cased', () => {
    handle = start(context(), { reason: 'trigger' })
    const hint = shadows.current().querySelector('.hint')!
    const groups = hint.querySelectorAll('.kbd-group')
    expect(groups).toHaveLength(1)
    expect(Array.from(groups[0]!.children, (node) => [node.localName, node.textContent])).toEqual([
      ['kbd', 'Shift'],
      ['kbd', 'Z'],
    ])
    // The caps carry no text between them (the group's gap spaces them).
    expect(hint.firstChild!.textContent).toBe('Pulsa ')
    expect(hint.lastChild!.textContent).toBe(' para editar o comentar')
  })

  it('the shadow stylesheet carries the Kbd rule and the 2px group gap', () => {
    handle = start(context(), { reason: 'trigger' })
    const css = Array.from(shadows.current().querySelectorAll('style'), (s) => s.textContent).join(
      '\n',
    )
    const rule = /(?:^|\n)kbd \{([^}]*)\}/.exec(css)?.[1] ?? ''
    // Whole declarations: `-webkit-user-select: none` alone must not pass for `user-select: none`.
    const decls = rule.split(';').map((d) => d.replace(/\s+/g, ' ').trim())
    expect(decls).toEqual(
      expect.arrayContaining([
        'height: 20px',
        'min-width: 20px',
        'padding: 0 6px',
        'border-radius: 4px',
        'user-select: none',
      ]),
    )
    expect(css).toMatch(/\.kbd-group \{[^}]*gap: 2px/)
  })
})
