import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Node's BroadcastChannel reaches every worker thread of the run, so each spec
// file talks on its own channel name; the code reads it from \`./config\`.
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  SIGNIN_CHANNEL: 'eel-zap-signin-spec',
}))

import {
  NEST_PRODUCTION_ORIGIN,
  PENDING_STORAGE_KEY,
  SIGNIN_CHANNEL,
  type SiteContext,
} from './config'
import { createState, savePending } from './oauth'
import { start } from './signin'
import { byText, captureShadowRoots, tick } from './spec-helpers'
import { readToken } from './token'

/**
 * The `signin` chunk (zap-cms-v2 §3.4, ADR 041; boards SitioLanzador,
 * SitioEntrar): the launcher in a closed shadow root, the popup sign-in whose
 * code comes back over BroadcastChannel, the full-page fallback, and where
 * the token ends up. Every refusal is attempted and must exchange nothing.
 */

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NEST = NEST_PRODUCTION_ORIGIN
const ACCESS = 'eel_at_ABCDEFGHIJKL_0123456789'

let shadows: ReturnType<typeof captureShadowRoots>
let handle: { destroy(): void } | null = null

function fakeWin(popup: unknown = { location: { href: '' }, close: vi.fn() }) {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ access_token: ACCESS, token_type: 'Bearer', expires_in: 3600 }),
        {
          status: 200,
        },
      ),
  )
  const location = {
    origin: 'https://ejemplo.com',
    pathname: '/blog/hola',
    search: '?zap',
    hash: '',
    assign: vi.fn(),
    replace: vi.fn(),
  }
  const win = {
    open: vi.fn(() => popup),
    location,
    crypto: window.crypto,
    sessionStorage: window.sessionStorage,
    fetch: fetchMock,
  } as unknown as Window
  return { win, fetchMock, location, popup }
}

function context(win: Window, locale: 'es' | 'en' = 'es') {
  const ctx: SiteContext = {
    win,
    doc: document,
    siteId: SITE,
    zapOrigin: 'https://zap.eel.software',
    authOrigin: NEST,
    clientId: `https://zap.eel.software/oauth/clients/${SITE}.json`,
    redirectUri: 'https://ejemplo.com/',
    locale,
    shortcut: 'Z',
    open: vi.fn(async () => {}),
    close: vi.fn(),
  }
  return ctx
}

const root = () => shadows.current()
const signInButton = () => root().querySelector('[data-action="sign-in"]') as HTMLButtonElement

async function broadcast(data: unknown) {
  const channel = new BroadcastChannel(SIGNIN_CHANNEL)
  channel.postMessage(data)
  channel.close()
  await tick(20)
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  shadows = captureShadowRoots()
})
afterEach(() => {
  handle?.destroy()
  handle = null
  vi.restoreAllMocks()
})

describe('the launcher', () => {
  it('renders in a CLOSED shadow root the page cannot reach', () => {
    handle = start(context(fakeWin().win), { reason: 'trigger' })
    const host = document.documentElement.querySelector('eel-zap-site')!
    expect(host).not.toBeNull()
    expect(host.shadowRoot).toBeNull()
    expect(shadows.roots.map((entry) => entry.mode)).toEqual(['closed'])
    // Nothing of ours is in the light DOM.
    expect(document.body.textContent).not.toContain('Editar o comentar')
  })

  it('shows only «Editar o comentar» and the Shift Z hint until clicked, then «Entrar con Eel»', () => {
    handle = start(context(fakeWin().win), { reason: 'trigger' })
    expect(byText(root(), 'Editar o comentar')).not.toBeNull()
    const hint = root().querySelector('[role="tooltip"]')!
    expect(hint.textContent).toBe('Pulsa Shift Z para editar o comentar')
    expect(Array.from(hint.querySelectorAll('kbd'), (kbd) => kbd.textContent)).toEqual([
      'Shift',
      'Z',
    ])
    expect(signInButton()).toBeNull()
    byText(root(), 'Editar o comentar')!.click()
    expect(signInButton().textContent).toBe('Entrar con Eel')
    expect(root().querySelector('[role="tooltip"]')).toBeNull()
    expect(root().textContent).toContain('Edita o comenta esta página')
    expect(root().textContent).toContain('Los visitantes no ven nada de esto')
  })

  it('sits at the bottom centre, off the corners sites keep for their own buttons', () => {
    handle = start(context(fakeWin().win), { reason: 'trigger' })
    const css = Array.from(root().querySelectorAll('style'), (style) => style.textContent).join('')
    const rule = (selector: string) =>
      new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    for (const selector of ['.launcher', '.hint']) {
      expect(rule(selector), selector).toContain('left: 50%')
      expect(rule(selector), selector).toContain('transform: translateX(-50%)')
      expect(rule(selector), selector).not.toMatch(/right:/)
    }
    // The panel: 320px wide, centred on the launcher.
    expect(rule('.panel')).toContain('left: calc(50% - 160px)')
    expect(rule('.panel')).toContain('width: 320px')
    expect(rule('.panel')).not.toMatch(/right:/)
  })

  it('no hint when the site turned the shortcut off', () => {
    const ctx = context(fakeWin().win)
    ctx.shortcut = false
    handle = start(ctx, { reason: 'trigger' })
    expect(byText(root(), 'Editar o comentar')).not.toBeNull()
    expect(root().querySelector('[role="tooltip"]')).toBeNull()
  })

  it.each([
    ['es', 'Entrar con Eel', 'Sign in with Eel'],
    ['en', 'Sign in with Eel', 'Entrar con Eel'],
  ] as const)('speaks %s, and only %s', (locale, own, other) => {
    handle = start(context(fakeWin().win, locale), { reason: 'expired' })
    expect(signInButton().textContent).toBe(own)
    expect(root().textContent).not.toContain(other)
  })

  it('after the hour, opens straight on the sign-in prompt, one click away', () => {
    handle = start(context(fakeWin().win), { reason: 'expired' })
    expect(root().textContent).toContain('Tu sesión terminó')
    expect(signInButton()).not.toBeNull()
  })
})

describe('signing in with the popup', () => {
  async function openPopup() {
    const fake = fakeWin()
    const ctx = context(fake.win)
    handle = start(ctx, { reason: 'expired' })
    signInButton().click()
    const popup = fake.popup as { location: { href: string } }
    await vi.waitFor(() => expect(popup.location.href).not.toBe(''))
    const authorize = new URL(popup.location.href)
    return { ...fake, ctx, state: authorize.searchParams.get('state')!, authorize }
  }

  it('opens the popup inside the click and points it at Nest with PKCE', async () => {
    const { win, authorize, state } = await openPopup()
    expect(win.open).toHaveBeenCalledTimes(1)
    expect(authorize.origin + authorize.pathname).toBe(`${NEST}/oauth/authorize`)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(state.startsWith('zap1.')).toBe(true)
    expect(root().textContent).toContain('Esperando a Eel')
    // The popup flow keeps its verifier in memory: nothing pending in storage.
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
  })

  it('the code over BroadcastChannel is exchanged, and the token lands in sessionStorage only', async () => {
    const { fetchMock, ctx, state } = await openPopup()
    await broadcast({ type: 'eelzap:callback', code: 'the-code', state, iss: NEST })
    await vi.waitFor(() => expect(ctx.open).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = Object.fromEntries(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams,
    )
    expect(body).toMatchObject({ code: 'the-code', grant_type: 'authorization_code' })
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(readToken(window, SITE)?.token).toBe(ACCESS)
    expect(localStorage.length).toBe(0)
    expect(document.cookie).not.toContain('eel_at_')
    // A sign-in after the hour ran out: the toolbar says «Sesión renovada».
    expect(ctx.open).toHaveBeenCalledWith('suggest', { reason: 'renewed' })
  })

  it('a first sign-in opens the tools without the renewal notice', async () => {
    const fake = fakeWin()
    const ctx = context(fake.win)
    handle = start(ctx, { reason: 'trigger' })
    byText(root(), 'Editar o comentar')!.click()
    signInButton().click()
    const popup = fake.popup as { location: { href: string } }
    await vi.waitFor(() => expect(popup.location.href).not.toBe(''))
    const state = new URL(popup.location.href).searchParams.get('state')!
    await broadcast({ type: 'eelzap:callback', code: 'the-code', state, iss: NEST })
    await vi.waitFor(() => expect(ctx.open).toHaveBeenCalled())
    expect(ctx.open).toHaveBeenCalledWith('suggest', undefined)
  })

  it('a state mismatch is ignored: nothing is exchanged', async () => {
    const { fetchMock, state } = await openPopup()
    await broadcast({ type: 'eelzap:callback', code: 'c', state: `${state}x`, iss: NEST })
    await broadcast({ type: 'eelzap:callback', code: 'c', state: 'zap1.other', iss: NEST })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readToken(window, SITE)).toBeNull()
  })

  it('an issuer mismatch is refused: nothing is exchanged, and the state is spent', async () => {
    const { fetchMock, state } = await openPopup()
    await broadcast({ type: 'eelzap:callback', code: 'c', state, iss: 'https://evil.example' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(root().textContent).toContain('No pudimos completar la entrada')
    // The same state cannot be replayed with the right issuer afterwards.
    await broadcast({ type: 'eelzap:callback', code: 'c', state, iss: NEST })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a refused exchange stores nothing', async () => {
    const { fetchMock, state } = await openPopup()
    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }))
    await broadcast({ type: 'eelzap:callback', code: 'c', state, iss: NEST })
    await vi.waitFor(() => expect(root().textContent).toContain('No pudimos completar la entrada'))
    expect(readToken(window, SITE)).toBeNull()
  })
})

describe('popup blocked: the full-page redirect', () => {
  it('sends the tab to Nest with the return path in state, verifier pending in sessionStorage', async () => {
    const fake = fakeWin(null)
    handle = start(context(fake.win), { reason: 'expired' })
    signInButton().click()
    await vi.waitFor(() => expect(fake.location.assign).toHaveBeenCalledTimes(1))
    const authorize = new URL(fake.location.assign.mock.calls[0]![0] as string)
    const state = authorize.searchParams.get('state')!
    const pending = JSON.parse(sessionStorage.getItem(PENDING_STORAGE_KEY)!)
    expect(pending).toMatchObject({ state, mode: 'redirect' })
    expect(state.split('.')).toHaveLength(3)
  })

  it('the callback page finishes it and goes back to the path in state', async () => {
    const fake = fakeWin()
    const state = createState(window, '/blog/hola?zap')
    savePending(window, { state, verifier: 'v'.repeat(43), mode: 'redirect' })
    fake.location.pathname = '/'
    fake.location.search = ''
    handle = start(context(fake.win), { callback: { code: 'the-code', state, iss: NEST } })
    await vi.waitFor(() => expect(fake.location.replace).toHaveBeenCalled())
    expect(fake.fetchMock).toHaveBeenCalledTimes(1)
    expect(readToken(window, SITE)?.token).toBe(ACCESS)
    expect(fake.location.replace).toHaveBeenCalledWith('/blog/hola?zap')
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
  })

  it.each([
    ['another state', (state: string) => ({ code: 'c', state: `${state}x`, iss: NEST })],
    ['another issuer', (state: string) => ({ code: 'c', state, iss: 'https://evil.example' })],
  ])('refuses a callback with %s', async (_label, make) => {
    const fake = fakeWin()
    const state = createState(window, '/x')
    savePending(window, { state, verifier: 'v'.repeat(43), mode: 'redirect' })
    handle = start(context(fake.win), { callback: make(state) })
    await tick()
    expect(fake.fetchMock).not.toHaveBeenCalled()
    expect(readToken(window, SITE)).toBeNull()
    expect(fake.location.replace).not.toHaveBeenCalled()
  })

  it('refuses a callback when the pending sign-in was a popup one', async () => {
    const fake = fakeWin()
    const state = createState(window)
    savePending(window, { state, verifier: 'v'.repeat(43), mode: 'popup' })
    handle = start(context(fake.win), { callback: { code: 'c', state, iss: NEST } })
    await tick()
    expect(fake.fetchMock).not.toHaveBeenCalled()
  })
})
