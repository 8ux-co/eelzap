import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Node's BroadcastChannel reaches every worker thread of the run, so each spec
// file talks on its own channel name; the code reads it from \`./config\`.
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  SIGNIN_CHANNEL: 'eel-zap-boot-spec',
}))

const loaded = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; options: unknown; ctx: unknown }>,
}))

vi.mock('./load', () => ({
  loadChunk: async (name: string) => ({
    start: (ctx: unknown, options: unknown) => {
      loaded.calls.push({ name, options, ctx })
      return { destroy: () => {} }
    },
  }),
}))

import { __resetLiveForTests, initZap } from '../live'
import { NEST_PRODUCTION_ORIGIN, PENDING_STORAGE_KEY, type SiteContext } from './config'
import { readCallback, startSiteMode } from './boot'
import { writeToken } from './token'

/**
 * The core's part of suggestion mode (zap-cms-v2 §3.4, §7.3 "Overlay as an
 * attack surface on public pages"): nothing loads for an ordinary visitor;
 * `?zap` or Shift Z loads the launcher, never while typing; a live token loads
 * the suggestion UI; the OAuth callback is relayed and cleaned up.
 */

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NEST = NEST_PRODUCTION_ORIGIN
let stop: (() => void) | null = null

function boot(shortcut?: string | false) {
  stop = startSiteMode({
    win: window,
    siteId: SITE,
    zapOrigin: 'https://zap.eel.software',
    authOrigin: NEST,
    shortcut,
  })
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
const shiftZ = (target?: EventTarget, init: KeyboardEventInit = {}) =>
  press('Z', { shiftKey: true, ...init }, target)
const go = (url: string) => window.history.replaceState(null, '', url)

beforeEach(() => {
  loaded.calls = []
  sessionStorage.clear()
  go('/')
})
afterEach(() => {
  stop?.()
  stop = null
  __resetLiveForTests()
  vi.restoreAllMocks()
})

describe('nothing for an ordinary visitor', () => {
  it('loads no chunk and draws nothing on a plain page', async () => {
    boot()
    await flush()
    expect(loaded.calls).toEqual([])
    expect(document.documentElement.querySelector('eel-zap-site')).toBeNull()
  })

  it('Shift alone, Shift twice, Z alone or Shift with another letter open nothing', async () => {
    boot()
    press('Shift', { shiftKey: true })
    press('Shift', { shiftKey: true })
    press('z')
    press('A', { shiftKey: true })
    // A held key repeats; a repeat is not a press.
    shiftZ(window, { repeat: true })
    // Shift Z with Cmd, Ctrl or Alt is the site's or the browser's.
    shiftZ(window, { metaKey: true })
    shiftZ(window, { ctrlKey: true })
    shiftZ(window, { altKey: true })
    await flush()
    expect(loaded.calls).toEqual([])
  })

  it.each([
    ['an input', '<input id="t">'],
    ['a textarea', '<textarea id="t"></textarea>'],
    ['a select', '<select id="t"><option>a</option></select>'],
    ['a contenteditable element', '<div contenteditable="true"><p id="t">texto</p></div>'],
  ])('Shift Z typed in %s is a capital Z, nothing else', async (_label, markup) => {
    document.body.innerHTML = markup
    boot()
    shiftZ(document.getElementById('t')!)
    await flush()
    expect(loaded.calls).toEqual([])
    document.body.innerHTML = ''
  })

  it('Shift Z inside an IME composition opens nothing (isComposing, or keyCode 229)', async () => {
    boot()
    shiftZ(window, { isComposing: true })
    shiftZ(window, { keyCode: 229 })
    await flush()
    expect(loaded.calls).toEqual([])
  })
})

describe('the opt-in trigger', () => {
  it('?zap in the URL loads the launcher', async () => {
    go('/blog/hola?zap')
    boot()
    await flush()
    expect(loaded.calls.map((call) => call.name)).toEqual(['signin'])
  })

  it('Shift Z loads the launcher, once', async () => {
    boot()
    shiftZ()
    await flush()
    shiftZ(document.body)
    await flush()
    expect(loaded.calls.map((call) => call.name)).toEqual(['signin'])
  })

  it('lower case z with Shift (Caps Lock on) counts too', async () => {
    boot()
    press('z', { shiftKey: true })
    await flush()
    expect(loaded.calls.map((call) => call.name)).toEqual(['signin'])
  })

  it('the letter is configurable, and the shortcut can be turned off', async () => {
    boot('K')
    shiftZ()
    await flush()
    expect(loaded.calls).toEqual([])
    press('K', { shiftKey: true })
    await flush()
    expect(loaded.calls.map((call) => call.name)).toEqual(['signin'])
    expect((loaded.calls[0]!.ctx as SiteContext).shortcut).toBe('K')
    stop?.()
    loaded.calls = []
    boot(false)
    shiftZ()
    await flush()
    expect(loaded.calls).toEqual([])
  })

  it('a live token for this site loads the suggestion UI straight away', async () => {
    writeToken(window, {
      token: 'eel_at_ABCDEFGHIJKL_0123',
      exp: Date.now() + 3_600_000,
      site: SITE,
    })
    boot()
    await flush()
    expect(loaded.calls.map((call) => call.name)).toEqual(['suggest'])
  })

  it('a token for another site does not', async () => {
    writeToken(window, {
      token: 'eel_at_ABCDEFGHIJKL_0123',
      exp: Date.now() + 3_600_000,
      site: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })
    boot()
    await flush()
    expect(loaded.calls).toEqual([])
  })
})

describe('the OAuth callback on {origin}/', () => {
  const CALLBACK = `/?code=the-code&state=zap1.nonce&iss=${encodeURIComponent(NEST)}`

  it('in the popup: hands the code to the opener over BroadcastChannel, cleans the URL, closes', async () => {
    const received: unknown[] = []
    const listener = new BroadcastChannel('eel-zap-boot-spec')
    listener.onmessage = (event) => received.push(event.data)
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    go(CALLBACK)
    boot()
    await new Promise((resolve) => setTimeout(resolve, 20))
    listener.close()
    expect(received).toEqual([
      { type: 'eelzap:callback', code: 'the-code', state: 'zap1.nonce', iss: NEST },
    ])
    expect(window.location.search).toBe('')
    expect(close).toHaveBeenCalled()
    expect(loaded.calls).toEqual([])
  })

  it('after a full-page redirect in this tab: the signin chunk finishes it', async () => {
    sessionStorage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({ state: 'zap1.nonce', verifier: 'v', mode: 'redirect' }),
    )
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    go(CALLBACK)
    boot()
    await flush()
    expect(close).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
    expect(loaded.calls).toEqual([
      {
        name: 'signin',
        options: { callback: { code: 'the-code', state: 'zap1.nonce', iss: NEST } },
        ctx: expect.anything(),
      },
    ])
  })

  it.each([
    ['another issuer', `/?code=c&state=zap1.n&iss=${encodeURIComponent('https://evil.example')}`],
    ['no issuer', '/?code=c&state=zap1.n'],
    [
      'a state that is not ours (the site’s own OAuth)',
      `/?code=c&state=abc&iss=${encodeURIComponent(NEST)}`,
    ],
    ['another path', `/login?code=c&state=zap1.n&iss=${encodeURIComponent(NEST)}`],
  ])('ignores %s: the page and its URL are left alone', (_label, url) => {
    go(url)
    expect(readCallback(window, NEST)).toBeNull()
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    boot()
    expect(close).not.toHaveBeenCalled()
    expect(window.location.pathname + window.location.search).toBe(url)
  })
})

describe('initZap outside a frame', () => {
  it('needs the site id: without one, suggestion mode stays off', async () => {
    go('/?zap')
    const live = initZap({ siteKey: 'verdeorigen' }, { win: window, parent: window as never })
    await flush()
    expect(live.active).toBe(false)
    expect(loaded.calls).toEqual([])
  })

  it('with the site id: production Zap and Nest, and the site client id', async () => {
    go('/?zap')
    initZap({ siteKey: 'verdeorigen', siteId: SITE }, { win: window, parent: window as never })
    await flush()
    const ctx = loaded.calls[0]!.ctx as SiteContext
    expect(ctx.zapOrigin).toBe('https://zap.eel.software')
    expect(ctx.authOrigin).toBe(NEST)
    expect(ctx.clientId).toBe(`https://zap.eel.software/oauth/clients/${SITE}.json`)
    expect(ctx.redirectUri).toBe(`${window.location.origin}/`)
  })

  it('a non-local authOrigin is ignored; a local one on a local page is honoured', async () => {
    go('/?zap')
    initZap(
      { siteKey: 'v', siteId: SITE, authOrigin: 'https://evil.example' },
      { win: window, parent: window as never },
    )
    await flush()
    expect((loaded.calls[0]!.ctx as SiteContext).authOrigin).toBe(NEST)
    __resetLiveForTests()
    loaded.calls = []
    initZap(
      {
        siteKey: 'v',
        siteId: SITE,
        authOrigin: 'http://localhost:5044',
        zapOrigin: 'http://localhost:5047',
      },
      { win: window, parent: window as never },
    )
    await flush()
    const ctx = loaded.calls[0]!.ctx as SiteContext
    expect(ctx.authOrigin).toBe('http://localhost:5044')
    expect(ctx.clientId).toBe(`http://localhost:5047/oauth/clients/${SITE}.json`)
  })
})
