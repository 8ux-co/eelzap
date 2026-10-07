import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OnPage } from './api'
import type { SiteContext, StartOptions } from './config'
import { DRAFT_SESSION_KEY, EDIT_INTENT_KEY } from './draft-session'
import { REFRESH_LEAD_MS } from './session'
import { captureShadowRoots, tick } from './spec-helpers'
import { start } from './suggest'
import { readSession, writeToken, type SiteToken } from './token'

/**
 * The bar's two lifecycles, end to end through the `suggest` chunk against a
 * faked Zap and Nest:
 *
 * - **Item 13, live «Editar» through a draft session** (ADR 041 amendment
 *   2026-10-06): an untagged page exchanges and navigates through the site's
 *   draft route; a tagged one does not; a failure is the «no fields» empty
 *   state with its reason; Editar reopens after the reload; Comentar never
 *   needs any of it; sign-out leaves the draft session.
 * - **Item 32, the token lifecycle**: a 401 renews silently and the request
 *   is retried; a renewal that fails is «Tu sesión de Zap expiró» with
 *   «Volver a entrar»; a 403 is the «No puedes editar ni comentar» card; an
 *   inline edit in progress survives a renewal.
 */

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ZAP = 'https://zap.eel.software'
const NEST = 'https://auth.eel.software'
const ACCESS = 'eel_at_ABCDEFGHIJKL_0123456789'
const ACCESS_2 = 'eel_at_ZYXWVUTSRQPO_9876543210'
const REFRESH = 'eel_rt_ABCDEFGHIJKL_0123456789'
const ZPT = `zpt_${'A'.repeat(43)}`
const ROUTE = '/api/zap-preview'

const TAGGED = `
  <article data-zap-entry="blog/hola">
    <h1 data-zap="blog/hola#title">Cosecha de octubre</h1>
    <p id="plain">Texto sin etiqueta</p>
  </article>`
/** The same page as published: no stega, no `data-zap`. */
const PUBLISHED = `
  <article>
    <h1>Cosecha de octubre</h1>
    <p id="plain">Texto sin etiqueta</p>
  </article>`

const onPage = (over: Partial<OnPage> = {}): OnPage => ({
  viewer: { name: 'Camila Restrepo' },
  liveEditing: true,
  fields: { 'blog/hola': { title: { type: 'TEXT', label: 'Título' } } },
  comments: [],
  truncated: false,
  ...over,
})

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

type Route = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: {
  onPage: Route
  session: Route
  sessionDelete: Route
  draft: Route
  create: Route
  nest: Route
  exit: Route
}
let fetchMock: ReturnType<typeof vi.fn>
let shadows: ReturnType<typeof captureShadowRoots>
let handle: { destroy(): void } | null = null
let ctx: SiteContext
let assign: ReturnType<typeof vi.fn>
let reload: ReturnType<typeof vi.fn>

function mockLocation() {
  const real = window.location
  assign = vi.fn()
  reload = vi.fn()
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    href: real.href,
    origin: real.origin,
    protocol: real.protocol,
    host: real.host,
    hostname: real.hostname,
    port: real.port,
    pathname: real.pathname,
    search: real.search,
    hash: real.hash,
    assign,
    reload,
    replace: vi.fn(),
  } as unknown as Location)
}

function boot(options: StartOptions = {}, draftRoute: string | null = ROUTE) {
  ctx = {
    win: window,
    doc: document,
    siteId: SITE,
    zapOrigin: ZAP,
    authOrigin: NEST,
    clientId: `${ZAP}/oauth/clients/${SITE}.json`,
    redirectUri: `${window.location.origin}/`,
    locale: 'es',
    shortcut: 'Z',
    draftRoute,
    open: vi.fn(async () => {}),
    close: vi.fn(),
  }
  handle = start(ctx, options)
}

async function ready(options: StartOptions = {}, draftRoute: string | null = ROUTE) {
  boot(options, draftRoute)
  await tick()
}

const root = () => shadows.current()
const tool = (name: 'navigate' | 'edit' | 'comment') =>
  root().querySelector(`[data-mode="${name}"]`) as HTMLButtonElement
const action = (name: string) => root().querySelector(`[data-action="${name}"]`) as HTMLElement
const $ = (selector: string) => document.querySelector(selector) as HTMLElement
const calls = (match: (url: string, init: RequestInit) => boolean) =>
  (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url, init]) => match(url, init))
const sessionPosts = () =>
  calls((url, init) => url.endsWith('/api/public/v1/preview/session') && init.method === 'POST')

function click(element: Element) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

function store(over: Partial<SiteToken> = {}) {
  writeToken(window, {
    token: ACCESS,
    exp: Date.now() + 3_600_000,
    site: SITE,
    refresh: REFRESH,
    rexp: Date.now() + 8 * 3_600_000,
    ...over,
  })
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(null, '', '/blog/hola')
  document.body.innerHTML = TAGGED
  store()
  shadows = captureShadowRoots()
  routes = {
    onPage: () => json(onPage()),
    session: () =>
      json(
        {
          url: `${window.location.origin}${ROUTE}?${new URLSearchParams({ token: ZPT, path: '/blog/hola' })}`,
          path: '/blog/hola',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
        201,
      ),
    sessionDelete: () => new Response(null, { status: 204 }),
    draft: () => json({ thread: { id: 't' }, draftVersionId: 'v' }, 201),
    create: () => json({ thread: { id: 'new', assignee: null }, comments: [] }, 201),
    nest: () =>
      json({
        access_token: ACCESS_2,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: REFRESH,
      }),
    exit: () => new Response(null, { status: 200 }),
  }
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.startsWith(NEST)) return routes.nest(url, init)
    if (url.includes('/comments/on-page')) return routes.onPage(url, init)
    if (url.endsWith('/comments/save-to-draft')) return routes.draft(url, init)
    if (url.endsWith('/comments')) return routes.create(url, init)
    if (url.endsWith('/preview/session')) {
      return init.method === 'DELETE' ? routes.sessionDelete(url, init) : routes.session(url, init)
    }
    if (url.includes(`${ROUTE}/exit`)) return routes.exit(url, init)
    throw new Error(`unexpected ${url}`)
  })
  vi.spyOn(window, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch)
})

afterEach(() => {
  handle?.destroy()
  handle = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('item 13: Editar on the live site through a draft session', () => {
  it('a tagged page (already in draft mode) edits at once: no exchange', async () => {
    mockLocation()
    await ready()
    tool('edit').click()
    await tick()
    expect(tool('edit').getAttribute('aria-pressed')).toBe('true')
    expect(sessionPosts()).toHaveLength(0)
    expect(assign).not.toHaveBeenCalled()
  })

  it('an untagged page: «Preparando la edición…», the exchange, then the tab goes through the draft route', async () => {
    document.body.innerHTML = PUBLISHED
    mockLocation()
    let answer!: (response: Response) => void
    routes.session = () => new Promise<Response>((resolve) => (answer = resolve))
    await ready()
    tool('edit').click()
    await tick()
    expect(root().querySelector('.status')!.textContent).toBe('Preparando la edición…')

    const [[url, init]] = sessionPosts()
    expect(url).toBe(`${ZAP}/api/public/v1/preview/session`)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS}`)
    expect(JSON.parse(String(init.body))).toEqual({ draftRoute: ROUTE, path: '/blog/hola' })

    const target = `${window.location.origin}${ROUTE}?${new URLSearchParams({ token: ZPT, path: '/blog/hola' })}`
    answer(
      json(
        {
          url: target,
          path: '/blog/hola',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
        201,
      ),
    )
    await tick()
    expect(assign).toHaveBeenCalledWith(target)
    const sent = new URL(assign.mock.calls[0]![0] as string)
    expect(sent.origin).toBe(window.location.origin)
    expect(sent.pathname).toBe(ROUTE)
    expect(sent.searchParams.get('path')).toBe('/blog/hola')
    // Editar reopens after the reload.
    expect(JSON.parse(sessionStorage.getItem(EDIT_INTENT_KEY)!)).toMatchObject({
      path: '/blog/hola',
    })
  })

  it('a site without a draft route: the «no fields» empty state says why, nothing is asked', async () => {
    document.body.innerHTML = PUBLISHED
    mockLocation()
    await ready({}, null)
    tool('edit').click()
    await tick()
    expect(root().textContent).toContain('No hay campos para editar aquí')
    expect(root().textContent).toContain('no tiene la ruta de vista previa')
    expect(sessionPosts()).toHaveLength(0)
    expect(assign).not.toHaveBeenCalled()
  })

  it('a failed exchange: the empty state with the reason, no navigation, Editar not on', async () => {
    document.body.innerHTML = PUBLISHED
    mockLocation()
    routes.session = () => json({ error: { code: 'FORBIDDEN' } }, 403)
    await ready()
    tool('edit').click()
    await tick()
    expect(root().textContent).toContain('No hay campos para editar aquí')
    expect(root().textContent).toContain('No pudimos preparar la página para editar')
    expect(assign).not.toHaveBeenCalled()
    expect(tool('edit').getAttribute('aria-pressed')).toBe('false')
  })

  it('already in this tab’s draft session and still untagged: the exchange runs again, once', async () => {
    document.body.innerHTML = PUBLISHED
    sessionStorage.setItem(
      DRAFT_SESSION_KEY,
      JSON.stringify({ exp: Date.now() + 600_000, origin: window.location.origin }),
    )
    mockLocation()
    await ready()
    tool('edit').click()
    await tick()
    expect(sessionPosts()).toHaveLength(1)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(new URL(assign.mock.calls[0]![0] as string).pathname).toBe(ROUTE)
  })

  it('the one retry is per page load: a second Editar on the same load is the empty state, no second exchange', async () => {
    document.body.innerHTML = PUBLISHED
    sessionStorage.setItem(
      DRAFT_SESSION_KEY,
      JSON.stringify({ exp: Date.now() + 600_000, origin: window.location.origin }),
    )
    mockLocation()
    routes.session = () => json({ error: { code: 'FORBIDDEN' } }, 403)
    await ready()
    tool('edit').click()
    await tick()
    expect(sessionPosts()).toHaveLength(1)
    expect(root().textContent).toContain('No pudimos preparar la página para editar')

    tool('edit').click()
    await tick()
    expect(root().textContent).toContain('No hay campos para editar aquí')
    expect(sessionPosts()).toHaveLength(1)
    expect(assign).not.toHaveBeenCalled()
  })

  it('a load the exchange itself brought, still untagged: the empty state, no retry (no loop)', async () => {
    document.body.innerHTML = PUBLISHED
    sessionStorage.setItem(
      DRAFT_SESSION_KEY,
      JSON.stringify({ exp: Date.now() + 600_000, origin: window.location.origin }),
    )
    sessionStorage.setItem(EDIT_INTENT_KEY, JSON.stringify({ path: '/blog/hola', at: Date.now() }))
    mockLocation()
    await ready()
    await tick()
    tool('edit').click()
    await tick()
    expect(root().textContent).toContain('No hay campos para editar aquí')
    expect(sessionPosts()).toHaveLength(0)
    expect(assign).not.toHaveBeenCalled()
  })

  it('back from the draft route, tagged, with the intent: Editar is on by itself', async () => {
    sessionStorage.setItem(EDIT_INTENT_KEY, JSON.stringify({ path: '/blog/hola', at: Date.now() }))
    mockLocation()
    await ready()
    await tick()
    expect(tool('edit').getAttribute('aria-pressed')).toBe('true')
    expect(sessionStorage.getItem(EDIT_INTENT_KEY)).toBeNull()
  })

  it('Comentar on an untagged page needs no draft session', async () => {
    document.body.innerHTML = PUBLISHED
    mockLocation()
    await ready()
    tool('comment').click()
    expect(click($('h1')).defaultPrevented).toBe(true)
    expect(sessionPosts()).toHaveLength(0)
    expect(assign).not.toHaveBeenCalled()
  })

  it('sign-out in a draft session revokes at Zap and drops the cookie through the exit route', async () => {
    sessionStorage.setItem(
      DRAFT_SESSION_KEY,
      JSON.stringify({ exp: Date.now() + 600_000, origin: window.location.origin }),
    )
    mockLocation()
    await ready()
    action('account')?.click()
    ;(root().querySelector('[data-action="sign-out"]') as HTMLElement | null)?.click()
    await tick()
    expect(
      calls((url, init) => url.endsWith('/preview/session') && init.method === 'DELETE'),
    ).toHaveLength(1)
    const [[exitUrl]] = calls((url) => url.includes(`${ROUTE}/exit`))
    expect(new URL(exitUrl).searchParams.get('path')).toBe('/blog/hola')
    expect(reload).toHaveBeenCalled()
    expect(readSession(window, SITE)).toBeNull()
  })
})

describe('item 32: the token lifecycle in the bar', () => {
  it('a 401 on the page read renews silently and retries: the bar works, no message', async () => {
    let first = true
    routes.onPage = (_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization
      if (first && auth === `Bearer ${ACCESS}`) {
        first = false
        return json({ error: { code: 'UNAUTHORIZED' } }, 401)
      }
      return json(onPage())
    }
    await ready()
    await tick()
    const reads = calls((url) => url.includes('/comments/on-page'))
    expect(reads.map(([, init]) => (init.headers as Record<string, string>).Authorization)).toEqual(
      [`Bearer ${ACCESS}`, `Bearer ${ACCESS_2}`],
    )
    expect(root().querySelector('[role="toolbar"]')).not.toBeNull()
    expect(root().textContent).not.toContain('expiró')
    expect(root().textContent).not.toContain('No puedes editar ni comentar')
  })

  it('renewal fails: «Tu sesión de Zap expiró» and «Volver a entrar», which signs in at once', async () => {
    routes.onPage = () => json({ error: { code: 'UNAUTHORIZED' } }, 401)
    routes.nest = () => json({ error: 'invalid_grant' }, 400)
    await ready()
    await tick()
    expect(root().textContent).toContain('Tu sesión de Zap expiró')
    expect(root().textContent).not.toContain('No puedes editar ni comentar')
    const again = action('sign-in-again')
    expect(again.textContent).toContain('Volver a entrar')
    again.click()
    expect(ctx.open).toHaveBeenCalledWith('signin', { reason: 'expired', signIn: true })
  })

  it('a 403 (no seat, or the site refused) is the «No puedes editar ni comentar» card, no renewal', async () => {
    routes.onPage = () => json({ error: { code: 'FORBIDDEN' } }, 403)
    await ready()
    expect(root().textContent).toContain('No puedes editar ni comentar en este sitio')
    expect(root().textContent).not.toContain('expiró')
    expect(calls((url) => url.startsWith(NEST))).toHaveLength(0)
  })

  it('an inline edit in progress survives a renewal, and its save uses the new token', async () => {
    store({ exp: Date.now() + REFRESH_LEAD_MS + 60_000 })
    await ready()
    tool('edit').click()
    const h1 = $('h1')
    click(h1)
    expect(h1.getAttribute('contenteditable')).not.toBeNull()
    h1.firstChild!.textContent = 'Cosecha de octubre en Pitalito'
    h1.dispatchEvent(new Event('input', { bubbles: true }))

    // The tab comes back near the end of the hour: the session renews.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60_000)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(calls((url) => url.startsWith(NEST))).toHaveLength(1))
    await tick()

    // Same element, still editable, the typed text kept.
    expect($('h1')).toBe(h1)
    expect(h1.getAttribute('contenteditable')).not.toBeNull()
    expect(h1.textContent).toBe('Cosecha de octubre en Pitalito')

    h1.dispatchEvent(new FocusEvent('blur'))
    await tick()
    const [[, init]] = calls((url) => url.endsWith('/comments/save-to-draft'))
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS_2}`)
  })

  it('a stored session whose hour is spent but whose refresh lives renews before the first read', async () => {
    store({ exp: Date.now() - 60_000 })
    await ready()
    await tick()
    const [[, init]] = calls((url) => url.includes('/comments/on-page'))
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS_2}`)
  })
})
