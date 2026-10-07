import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OnPage } from './api'
import type { SiteContext, StartOptions } from './config'
import { byText, captureShadowRoots, tick } from './spec-helpers'
import { start } from './suggest'
import { readToken, writeToken } from './token'

/**
 * The `suggest` chunk, «Editar» and «Comentar» on the live site (zap-cms-v2
 * §3.3, §3.4; boards SitioBarra, SitioEditar, SitioSugerencia, SitioEnviado,
 * SitioRenovacion), on a page tagged like the fixture site, against a faked
 * Zap:
 *
 * - Editar: in place on tagged TEXT / LONG_TEXT, an input for NUMBER / URL,
 *   saved straight to the draft; off when the site's `liveEditing` is off
 *   (disabled, «Desactivado por un administrador»), and a 403 turns it off;
 * - Comentar: the exact payloads of a plain comment, a change request and a
 *   change request with a proposal; a point on the page; several elements;
 * - pins: the numbers of the open comments, as text, oldest first;
 * - 401, 403 (readable and CORS-less), 429 and the Idempotency-Key;
 * - network strings rendered as text, never markup; stored selectors that
 *   cannot parse do not throw.
 */

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCESS = 'eel_at_ABCDEFGHIJKL_0123456789'
const ZAP = 'https://zap.eel.software'

const FIELDS: OnPage['fields'] = {
  'blog/hola': {
    title: { type: 'TEXT', label: 'Título' },
    summary: { type: 'LONG_TEXT', label: 'Resumen' },
    price: { type: 'NUMBER', label: 'Precio' },
    link: { type: 'URL', label: 'Enlace' },
    body: { type: 'TEXT', label: 'Cuerpo' },
    published_at: { type: 'DATE', label: 'Fecha' },
    cover: { type: 'RICH_TEXT', label: 'Portada' },
  },
}

function onPage(overrides: Partial<OnPage> = {}): OnPage {
  return {
    viewer: { name: 'Camila Restrepo' },
    liveEditing: true,
    fields: FIELDS,
    comments: [
      {
        id: 'r1',
        status: 'OPEN',
        isChangeRequest: true,
        createdAt: '2026-10-04T10:00:00.000Z',
        author: { name: 'Ana Rodríguez' },
        excerpt: 'Nombrar las fincas',
        anchors: [
          { fieldKey: 'title', tag: 'blog/hola#title', selector: null, rect: null, spot: null },
        ],
      },
    ],
    truncated: false,
    ...overrides,
  }
}

type Route = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: { onPage: Route; create: Route; draft: Route }
let fetchMock: ReturnType<typeof vi.fn>
let shadows: ReturnType<typeof captureShadowRoots>
let handle: { destroy(): void } | null = null
let ctx: SiteContext

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })
const created = (assignee: string | null = null) =>
  json({ thread: { id: 'new', assignee: assignee ? { name: assignee } : null }, comments: [] }, 201)

function boot(locale: 'es' | 'en' = 'es', options: StartOptions = {}) {
  ctx = {
    win: window,
    doc: document,
    siteId: SITE,
    zapOrigin: ZAP,
    authOrigin: 'https://auth.eel.software',
    clientId: `${ZAP}/oauth/clients/${SITE}.json`,
    redirectUri: `${window.location.origin}/`,
    locale,
    shortcut: 'Z',
    open: vi.fn(async () => {}),
    close: vi.fn(),
  }
  handle = start(ctx, options)
}

const root = () => shadows.current()
const popover = () => root().querySelector('.popover') as HTMLElement | null
const sendButton = () => root().querySelector('[data-action="send"]') as HTMLButtonElement
const textarea = () => root().querySelector('textarea.composer') as HTMLTextAreaElement
const valueInput = () => root().querySelector('.value') as HTMLInputElement | null
const tool = (name: 'navigate' | 'edit' | 'comment') =>
  root().querySelector(`[data-mode="${name}"]`) as HTMLButtonElement
const action = (name: string) => root().querySelector(`[data-action="${name}"]`) as HTMLElement
const overlayRoot = () => shadows.current('eel-zap-overlay')
async function drawnPins(): Promise<HTMLElement[]> {
  await tick(40)
  return Array.from(overlayRoot().querySelectorAll('.pin')) as HTMLElement[]
}
const $ = (selector: string) => document.querySelector(selector) as HTMLElement

function click(element: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  element.dispatchEvent(event)
  return event
}
function type(field: HTMLTextAreaElement | HTMLInputElement, value: string) {
  field.value = value
  field.dispatchEvent(new Event('input'))
}
function editInPlace(element: HTMLElement, value: string) {
  element.firstChild!.textContent = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
const leave = (element: HTMLElement) => element.dispatchEvent(new FocusEvent('blur'))
const key = (k: string, target: EventTarget = window, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
const posts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit).method === 'POST')
    .map(([url, init]) => ({
      url: url as string,
      headers: (init as RequestInit).headers as Record<string, string>,
      body: JSON.parse(String((init as RequestInit).body)),
    }))

beforeEach(async () => {
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(null, '', '/blog/hola?utm=x')
  document.body.innerHTML = `
    <article data-zap-entry="blog/hola">
      <h1 data-zap="blog/hola#title">Cosecha de octubre</h1>
      <p data-zap="blog/hola#summary">Así llegó la cosecha</p>
      <p data-zap="blog/hola#price">12</p>
      <a data-zap="blog/hola#link" href="https://ejemplo.com/tienda">Comprar</a>
      <div data-zap="blog/hola#body" data-zap-html>Cuerpo <b>rico</b></div>
      <div data-zap="blog/hola#cover">Portada</div>
      <span data-zap="blog/hola#published_at">12 de octubre</span>
      <p id="plain">Texto sin etiqueta</p>
    </article>`
  writeToken(window, { token: ACCESS, exp: Date.now() + 3_600_000, site: SITE })
  shadows = captureShadowRoots()
  routes = { onPage: () => json(onPage()), create: () => created(), draft: () => created() }
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/comments/on-page')) return routes.onPage(url, init)
    if (url.endsWith('/comments/save-to-draft')) return routes.draft(url, init)
    if (url.endsWith('/comments')) return routes.create(url, init)
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

async function ready(locale: 'es' | 'en' = 'es', options: StartOptions = {}) {
  boot(locale, options)
  await tick()
}

const PAGE_URL = () => `${window.location.origin}/blog/hola?utm=x`

describe('the toolbar (SitioBarra)', () => {
  it('renders in a closed shadow root: Navegar, Editar, Comentar, the open count, the account chip (no Salir)', async () => {
    await ready()
    const host = document.documentElement.querySelector('eel-zap-site')!
    expect(host.shadowRoot).toBeNull()
    expect(shadows.roots.find((entry) => entry.host === host)?.mode).toBe('closed')
    const toolbar = root().querySelector('[role="toolbar"]')!
    const group = toolbar.querySelector('[role="group"]')!
    expect(group.getAttribute('aria-label')).toBe('Herramienta')
    expect(Array.from(group.querySelectorAll('button'), (b) => b.textContent)).toEqual([
      'Navegar',
      'Editar',
      'Comentar',
    ])
    expect(toolbar.textContent).toContain('1 abierto')
    expect(toolbar.textContent).toContain('CR')
    // Salir moved into the account menu (SitioBarraEstados).
    expect(toolbar.textContent).not.toContain('Salir')
    expect(toolbar.querySelector('[data-action="exit"]')).toBeNull()
    expect(toolbar.textContent).not.toMatch(/Sugerir|Seleccionar/)
    // Navegar first: nothing on the page is taken over until the person picks a tool.
    expect(tool('navigate').getAttribute('aria-pressed')).toBe('true')
  })

  it('reads the page context once, for this page and its tagged records, with the bearer', async () => {
    await ready()
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe(`${ZAP}/api/public/v1/comments/on-page`)
    expect(parsed.searchParams.get('url')).toBe(PAGE_URL())
    expect(parsed.searchParams.get('refs')).toBe('blog/hola')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS}`)
    expect(init.credentials).toBe('omit')
  })

  it.each([
    ['es', ['Navegar', 'Editar', 'Comentar', '1 abierto'], ['Browse', 'Comment', '1 open']],
    ['en', ['Browse', 'Edit', 'Comment', '1 open'], ['Navegar', 'Editar', 'Comentar', 'abierto']],
  ] as const)('speaks %s only', async (locale, own, other) => {
    await ready(locale)
    // Read the toolbar, not the root: the root also holds the style sheet.
    const text = root().querySelector('[role="toolbar"]')!.textContent
    for (const word of own) expect(text).toContain(word)
    for (const word of other) expect(text).not.toContain(word)
  })

  it('Navegar intercepts nothing', async () => {
    await ready()
    expect(click($('h1')).defaultPrevented).toBe(false)
    expect(click($('a')).defaultPrevented).toBe(false)
    expect($('h1').hasAttribute('contenteditable')).toBe(false)
    expect(popover()).toBeNull()
  })

  it('«Cerrar sesión en Zap» (the account menu) forgets the token and closes', async () => {
    await ready()
    action('account').click()
    action('sign-out').click()
    expect(readToken(window, SITE)).toBeNull()
    expect(ctx.close).toHaveBeenCalled()
  })

  it('after a renewed sign-in says «Sesión renovada» with the person’s name (SitioRenovacion)', async () => {
    await ready('es', { reason: 'renewed' })
    expect(root().textContent).toContain('Sesión renovada')
    expect(root().textContent).toContain('Sigues como Camila Restrepo')
  })

  it('a first sign-in says nothing about renewing', async () => {
    await ready()
    expect(root().textContent).not.toContain('Sesión renovada')
  })
})

describe('Editar (SitioEditar)', () => {
  it('a tagged TEXT field is edited in place and saved straight to the draft', async () => {
    await ready()
    tool('edit').click()
    expect(tool('edit').getAttribute('aria-pressed')).toBe('true')
    const h1 = $('h1')
    expect(click(h1).defaultPrevented).toBe(true)
    expect(h1.getAttribute('contenteditable')).not.toBeNull()
    // No popover: the page itself is the editor.
    expect(popover()).toBeNull()

    editInPlace(h1, 'Cosecha de octubre en Pitalito')
    leave(h1)
    await tick()

    const [post] = posts()
    expect(post!.url).toBe(`${ZAP}/api/public/v1/comments/save-to-draft`)
    expect(post!.headers.Authorization).toBe(`Bearer ${ACCESS}`)
    expect(post!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(post!.body).toEqual({
      collection: 'blog',
      slug: 'hola',
      pageUrl: PAGE_URL(),
      anchors: [
        {
          field: { key: 'title' },
          dom: expect.objectContaining({
            tag: 'blog/hola#title',
            // The anchor was taken before the edit: it quotes what is published.
            textQuote: expect.objectContaining({ exact: 'Cosecha de octubre' }),
          }),
        },
      ],
      body: 'Cosecha de octubre en Pitalito',
      proposedValues: [{ fieldKey: 'title', value: 'Cosecha de octubre en Pitalito' }],
    })
    expect(post!.body.isChangeRequest).toBeUndefined()
    // The draft now says this: the page keeps it, no longer editable.
    expect(h1.textContent).toBe('Cosecha de octubre en Pitalito')
    expect(h1.hasAttribute('contenteditable')).toBe(false)
    expect(root().querySelector('.status')!.textContent).toBe('Guardado en el borrador')
  })

  it('Enter saves a one-line field; Escape puts it back and saves nothing', async () => {
    await ready()
    tool('edit').click()
    const h1 = $('h1')
    click(h1)
    editInPlace(h1, 'Borrado')
    key('Escape', h1)
    expect(h1.textContent).toBe('Cosecha de octubre')
    expect(h1.hasAttribute('contenteditable')).toBe(false)
    leave(h1)
    await tick()
    expect(posts()).toEqual([])

    click(h1)
    editInPlace(h1, 'Nuevo')
    key('Enter', h1)
    await tick()
    expect(posts()).toHaveLength(1)
  })

  it('unchanged text saves nothing', async () => {
    await ready()
    tool('edit').click()
    click($('h1'))
    leave($('h1'))
    await tick()
    expect(posts()).toEqual([])
  })

  it('NUMBER edits in a small input, never in the page', async () => {
    await ready()
    tool('edit').click()
    const price = $('p[data-zap="blog/hola#price"]')
    click(price)
    expect(price.hasAttribute('contenteditable')).toBe(false)
    expect(valueInput()!.value).toBe('12')
    type(valueInput()!, '15,5')
    key('Enter', valueInput()!)
    await tick()
    expect(posts()[0]!.body.proposedValues).toEqual([{ fieldKey: 'price', value: 15.5 }])
  })

  it('a field that is not text is not edited here: it says to comment instead', async () => {
    await ready()
    tool('edit').click()
    click($('span[data-zap="blog/hola#published_at"]'))
    click($('div[data-zap="blog/hola#body"]'))
    expect($('div[data-zap="blog/hola#body"]').hasAttribute('contenteditable')).toBe(false)
    expect(root().textContent).toContain('Esto no se edita aquí')
    expect(posts()).toEqual([])
  })

  it('liveEditing off: Editar is shown disabled with the reason, and edits nothing (SitioBarra)', async () => {
    routes.onPage = () => json(onPage({ liveEditing: false }))
    await ready()
    const edit = tool('edit')
    expect(edit.getAttribute('aria-disabled')).toBe('true')
    expect(edit.getAttribute('title')).toBe('Desactivado por un administrador')
    edit.click()
    expect(edit.getAttribute('aria-pressed')).toBe('false')
    expect(tool('navigate').getAttribute('aria-pressed')).toBe('true')
    const h1 = $('h1')
    expect(click(h1).defaultPrevented).toBe(false)
    expect(h1.hasAttribute('contenteditable')).toBe(false)
    expect(posts()).toEqual([])
  })

  it('a 403 from the save puts the text back and turns Editar off', async () => {
    routes.draft = () => json({ error: { code: 'FORBIDDEN' } }, 403)
    await ready()
    tool('edit').click()
    const h1 = $('h1')
    const original = h1.firstChild
    click(h1)
    editInPlace(h1, 'Otro')
    leave(h1)
    await tick()
    expect(h1.textContent).toBe('Cosecha de octubre')
    expect(h1.firstChild).toBe(original)
    expect(tool('edit').getAttribute('aria-disabled')).toBe('true')
    expect(tool('navigate').getAttribute('aria-pressed')).toBe('true')
    expect(root().textContent).toContain('Un administrador desactivó Editar en este sitio.')
  })
})

describe('Comentar (SitioSugerencia, SitioEnviado)', () => {
  async function commentOn(element: HTMLElement) {
    await ready()
    tool('comment').click()
    expect(click(element).defaultPrevented).toBe(true)
    expect(popover()).not.toBeNull()
  }

  it('a plain comment: the exact payload, no flag, no assignee, no proposal', async () => {
    await commentOn($('h1'))
    expect(popover()!.getAttribute('aria-label')).toBe('Nuevo comentario')
    expect(popover()!.querySelector('.chip')!.textContent).toBe('Título')
    // The page is never edited from Comentar.
    expect($('h1').hasAttribute('contenteditable')).toBe(false)
    expect(sendButton().disabled).toBe(true)
    type(textarea(), 'Nombrar las fincas ayuda')
    sendButton().click()
    await tick()
    const [post] = posts()
    expect(post!.url).toBe(`${ZAP}/api/public/v1/comments`)
    expect(post!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(post!.body).toEqual({
      collection: 'blog',
      slug: 'hola',
      isChangeRequest: false,
      pageUrl: PAGE_URL(),
      anchors: [
        { field: { key: 'title' }, dom: expect.objectContaining({ tag: 'blog/hola#title' }) },
      ],
      body: 'Nombrar las fincas ayuda',
    })
    for (const value of Object.values(post!.body.anchors[0].dom.rect as Record<string, number>)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(popover()).toBeNull()
    expect(root().textContent).toContain('Comentario enviado')
    // The open comments are read again, so the count and the pins follow.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('on-page'))).toHaveLength(2)
  })

  it('«Solicitar cambio»: a change request, assigned by Zap, never by the client', async () => {
    routes.create = () => created('Ana Rodríguez')
    await commentOn($('h1'))
    const toggle = action('request-change')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    toggle.click()
    expect(action('request-change').getAttribute('aria-checked')).toBe('true')
    expect(popover()!.textContent).toContain('La recibe la persona responsable en Zap.')
    type(textarea(), 'Cambiar el título')
    sendButton().click()
    await tick()
    const body = posts()[0]!.body
    expect(body.isChangeRequest).toBe(true)
    expect(body.proposedValues).toBeUndefined()
    expect(body).not.toHaveProperty('assigneeId')
    expect(root().textContent).toContain('Solicitud de cambio enviada')
    expect(root().textContent).toContain(
      'Ana Rodríguez la verá en Zap. La página no cambia hasta que se publique.',
    )
  })

  it('«Proponer texto»: the proposal goes with the change request', async () => {
    await commentOn($('h1'))
    // Only once the comment is a change request.
    expect(action('propose')).toBeNull()
    action('request-change').click()
    action('propose').click()
    expect(popover()!.textContent).toContain('Texto propuesto para Título')
    expect(popover()!.textContent).toContain('Ahora: Cosecha de octubre')
    expect(valueInput()!.value).toBe('Cosecha de octubre')
    type(valueInput()!, 'Cosecha de octubre en Pitalito y La Plata')
    type(textarea(), 'Nombrar las fincas ayuda')
    sendButton().click()
    await tick()
    expect(posts()[0]!.body).toMatchObject({
      isChangeRequest: true,
      body: 'Nombrar las fincas ayuda',
      proposedValues: [{ fieldKey: 'title', value: 'Cosecha de octubre en Pitalito y La Plata' }],
    })
    expect(root().textContent).toContain('con tu texto propuesto')
  })

  it('a proposal alone is enough, and becomes the body', async () => {
    await commentOn($('h1'))
    action('request-change').click()
    action('propose').click()
    expect(sendButton().disabled).toBe(true)
    type(valueInput()!, 'Nuevo')
    expect(sendButton().disabled).toBe(false)
    sendButton().click()
    await tick()
    expect(posts()[0]!.body).toMatchObject({ body: 'Nuevo', isChangeRequest: true })
  })

  it('an unchanged proposal, or one removed, or the flag turned off sends no proposed values', async () => {
    await commentOn($('h1'))
    action('request-change').click()
    action('propose').click()
    type(valueInput()!, 'Otra cosa')
    // Unticking «Solicitar cambio» drops the proposal with it: a plain comment has none.
    action('request-change').click()
    expect(valueInput()).toBeNull()
    type(textarea(), 'Solo un comentario')
    sendButton().click()
    await tick()
    expect(posts()[0]!.body.isChangeRequest).toBe(false)
    expect(posts()[0]!.body.proposedValues).toBeUndefined()
  })

  it('a NUMBER proposal must be a number', async () => {
    await commentOn($('p[data-zap="blog/hola#price"]'))
    action('request-change').click()
    action('propose').click()
    type(valueInput()!, 'doce')
    expect(sendButton().disabled).toBe(true)
    expect(root().textContent).toContain('Escribe un número.')
    type(valueInput()!, '15,5')
    sendButton().click()
    await tick()
    expect(posts()[0]!.body.proposedValues).toEqual([{ fieldKey: 'price', value: 15.5 }])
  })

  it.each([
    ['rich text', 'div[data-zap="blog/hola#body"]'],
    ['a DATE field', 'span[data-zap="blog/hola#published_at"]'],
    ['an untagged element', '#plain'],
  ])('%s takes a comment or a change request, never a proposal', async (_label, selector) => {
    await commentOn($(selector))
    action('request-change').click()
    expect(action('propose')).toBeNull()
  })

  it('an untagged element gets a dom-only anchor on the surrounding entry', async () => {
    await commentOn($('#plain'))
    type(textarea(), 'Esto sobra')
    sendButton().click()
    await tick()
    const body = posts()[0]!.body
    expect(body).toMatchObject({ collection: 'blog', slug: 'hola', isChangeRequest: false })
    expect(body.anchors[0].field).toBeUndefined()
    expect(body.anchors[0].dom.selector).toBeTruthy()
  })

  it('an element covering most of the page is commented as a point, with a pending pin', async () => {
    await ready()
    tool('comment').click()
    const article = $('article')
    vi.spyOn(article, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    click(article, { clientX: 40, clientY: 30 })
    expect(popover()).not.toBeNull()
    const pins = await drawnPins()
    // The open comment is 1, the new one waits as 2.
    expect(pins.map((pin) => pin.textContent)).toContain('2')
    type(textarea(), 'Falta una foto aquí')
    sendButton().click()
    await tick()
    const anchor = posts()[0]!.body.anchors[0]
    expect(Object.keys(anchor).sort()).toEqual(['spot', 'viewport'])
    expect(anchor.spot.x).toBeGreaterThanOrEqual(0)
    expect(anchor.spot.x).toBeLessThanOrEqual(1)
  })

  it('Shift click gathers elements; «Comentar» opens one comment with an anchor each', async () => {
    await ready()
    tool('comment').click()
    click($('h1'), { shiftKey: true })
    click($('#plain'), { shiftKey: true })
    expect(popover()).toBeNull()
    expect(root().textContent).toContain('2 elementos seleccionados')
    action('comment-selection').click()
    type(textarea(), 'Revisar los dos')
    sendButton().click()
    await tick()
    expect(posts()[0]!.body.anchors).toHaveLength(2)
  })

  it.each([
    ['es', 'Nuevo comentario'],
    ['en', 'New comment'],
  ] as const)(
    '[%s] Enter sends, Shift+Enter breaks the line, an IME Enter never sends',
    async (locale, label) => {
      await ready(locale)
      tool('comment').click()
      click($('h1'))
      expect(popover()!.getAttribute('aria-label')).toBe(label)
      const box = textarea()
      // Empty: Enter sends nothing.
      expect(key('Enter', box, { cancelable: true })).toBe(false)
      await tick()
      expect(posts()).toEqual([])
      type(box, 'Nombrar las fincas ayuda')
      // Not handled, so the textarea's own newline goes through.
      expect(key('Enter', box, { shiftKey: true, cancelable: true })).toBe(true)
      expect(key('Enter', box, { isComposing: true, cancelable: true })).toBe(true)
      const committing = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperty(committing, 'keyCode', { value: 229 })
      expect(box.dispatchEvent(committing)).toBe(true)
      await tick()
      expect(posts()).toEqual([])
      expect(key('Enter', box, { cancelable: true })).toBe(false)
      await tick()
      expect(posts()).toHaveLength(1)
      expect(posts()[0]!.body.body).toBe('Nombrar las fincas ayuda')
    },
  )

  describe('the footer: the field never submits, the band does (OWNER-PASS 19)', () => {
    const labelOf = () => sendButton().textContent

    it('a plain multiline field, then a full-bleed footer band with Cancelar and the primary', async () => {
      await commentOn($('h1'))
      const content = popover()!.querySelector('.content')!
      const foot = content.lastElementChild as HTMLElement
      expect(foot.className).toBe('foot')
      const buttons = Array.from(foot.querySelectorAll('button'))
      expect(buttons.map((button) => button.textContent)).toEqual(['Cancelar', 'Comentar'])
      expect(buttons[0]!.className).toBe('btn btn-outline')
      expect(buttons[1]).toBe(sendButton())
      expect(buttons[1]!.className).toBe('btn btn-primary')
      // The field is a bare textarea with nothing inside or beside it that sends.
      expect(textarea().parentElement).toBe(content)
      expect(textarea().children).toHaveLength(0)
      expect(content.querySelectorAll('[data-action="send"]')).toHaveLength(1)
      expect(foot.contains(sendButton())).toBe(true)
      // The rule bleeds through the content padding, like DialogFooter.
      const css = Array.from(root().querySelectorAll('style'))
        .map((style) => style.textContent)
        .join('')
      expect(css).toMatch(/\.foot \{[^}]*margin: 2px -15px -15px;[^}]*border-top: 1px solid/)
      foot.querySelector('button')!.click()
      expect(popover()).toBeNull()
    })

    it.each([
      ['es', 'Comentar', 'Solicitar cambio'],
      ['en', 'Comment', 'Request a change'],
    ] as const)(
      '[%s] the primary follows the mode: %s, then %s',
      async (locale, plain, flagged) => {
        await ready(locale)
        tool('comment').click()
        click($('h1'))
        expect(labelOf()).toBe(plain)
        action('request-change').click()
        expect(labelOf()).toBe(flagged)
        action('request-change').click()
        expect(labelOf()).toBe(plain)
      },
    )

    it('disabled until there is something to send', async () => {
      await commentOn($('h1'))
      // Plain and empty, or only spaces.
      expect(sendButton().disabled).toBe(true)
      type(textarea(), '   ')
      expect(sendButton().disabled).toBe(true)
      type(textarea(), 'Algo')
      expect(sendButton().disabled).toBe(false)
      type(textarea(), '')
      // A change request with only a proposal is enough.
      action('request-change').click()
      expect(sendButton().disabled).toBe(true)
      action('propose').click()
      // Unchanged is no proposal.
      expect(sendButton().disabled).toBe(true)
      type(valueInput()!, 'Cosecha nueva')
      expect(sendButton().disabled).toBe(false)
      expect(labelOf()).toBe('Solicitar cambio')
    })

    it('a change request whose NUMBER proposal does not parse stays disabled, text or not', async () => {
      await commentOn($('p[data-zap="blog/hola#price"]'))
      action('request-change').click()
      action('propose').click()
      type(valueInput()!, 'doce')
      expect(sendButton().disabled).toBe(true)
      type(textarea(), 'Revisar el precio')
      expect(sendButton().disabled).toBe(true)
      expect(key('Enter', textarea(), { cancelable: true })).toBe(false)
      await tick()
      expect(posts()).toEqual([])
    })

    it('Enter with only a proposal sends the change request', async () => {
      await commentOn($('h1'))
      action('request-change').click()
      action('propose').click()
      type(valueInput()!, 'Cosecha nueva')
      expect(key('Enter', textarea(), { cancelable: true })).toBe(false)
      await tick()
      expect(posts()[0]!.body).toMatchObject({ isChangeRequest: true, body: 'Cosecha nueva' })
    })
  })

  it('Escape closes the composer and sends nothing', async () => {
    await commentOn($('h1'))
    type(textarea(), 'Nada')
    key('Escape')
    expect(popover()).toBeNull()
    expect(posts()).toEqual([])
  })
})

describe('when Zap says no', () => {
  it('429: says when to retry, keeps the comment, and the retry reuses the Idempotency-Key', async () => {
    let calls = 0
    routes.create = () =>
      ++calls === 1
        ? json({ error: { code: 'RATE_LIMITED' } }, 429, { 'Retry-After': '12' })
        : created()
    await ready()
    tool('comment').click()
    click($('h1'))
    type(textarea(), 'Hola')
    sendButton().click()
    await tick()
    expect(root().textContent).toContain('Intenta de nuevo en 12 segundos.')
    expect(popover()).not.toBeNull()
    sendButton().click()
    await tick()
    const [first, second] = posts()
    expect(second!.headers['Idempotency-Key']).toBe(first!.headers['Idempotency-Key'])
    expect(root().textContent).toContain('Comentario enviado')
  })

  it('a changed payload gets a new Idempotency-Key', async () => {
    let calls = 0
    routes.create = () =>
      ++calls === 1
        ? json({ error: { code: 'RATE_LIMITED' } }, 429, { 'Retry-After': '1' })
        : created()
    await ready()
    tool('comment').click()
    click($('h1'))
    type(textarea(), 'Uno')
    sendButton().click()
    await tick()
    type(textarea(), 'Dos')
    sendButton().click()
    await tick()
    const [first, second] = posts()
    expect(second!.headers['Idempotency-Key']).not.toBe(first!.headers['Idempotency-Key'])
  })

  it('a CORS-less refusal (network error): «No puedes editar ni comentar en este sitio», nothing intercepted', async () => {
    routes.create = () => {
      throw new TypeError('Failed to fetch')
    }
    await ready()
    tool('comment').click()
    click($('h1'))
    type(textarea(), 'Hola')
    sendButton().click()
    await tick()
    expect(root().textContent).toContain('No puedes editar ni comentar en este sitio')
    expect(root().querySelector('[role="toolbar"]')).toBeNull()
    expect(click($('h1')).defaultPrevented).toBe(false)
  })

  it('a readable 403 on the page read (no seat) is the same refusal', async () => {
    routes.onPage = () => json({ error: { code: 'FORBIDDEN' } }, 403)
    await ready()
    expect(root().textContent).toContain('No puedes editar ni comentar en este sitio')
    expect(root().querySelector('[role="toolbar"]')).toBeNull()
  })

  it('401 with nothing to renew with: «Tu sesión de Zap expiró», never the refusal; «Volver a entrar» signs in at once', async () => {
    routes.draft = () => json({ error: { code: 'UNAUTHORIZED' } }, 401)
    await ready()
    tool('edit').click()
    click($('h1'))
    editInPlace($('h1'), 'Nuevo')
    leave($('h1'))
    await tick()
    expect(readToken(window, SITE)).toBeNull()
    expect(root().textContent).toContain('Tu sesión de Zap expiró')
    expect(root().textContent).not.toContain('No puedes editar ni comentar')
    action('sign-in-again').click()
    expect(ctx.open).toHaveBeenCalledWith('signin', { reason: 'expired', signIn: true })
  })

  it('no live token at start: straight to the sign-in prompt, nothing drawn', () => {
    sessionStorage.clear()
    boot()
    expect(ctx.open).toHaveBeenCalledWith('signin', { reason: 'expired' })
    expect(document.documentElement.querySelector('eel-zap-site')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('pins and text-only rendering', () => {
  const thread = (
    id: string,
    createdAt: string,
    anchors: OnPage['comments'][number]['anchors'],
  ) => ({
    id,
    status: 'OPEN' as const,
    isChangeRequest: false,
    createdAt,
    author: { name: `Autor ${id}` },
    excerpt: `Primera línea ${id}`,
    anchors,
  })
  const titleAnchor = {
    fieldKey: 'title',
    tag: 'blog/hola#title',
    selector: null,
    rect: null,
    spot: null,
  }
  const spot = { fieldKey: null, tag: null, selector: null, rect: null, spot: { x: 0.2, y: 0.3 } }

  it('numbers the open comments oldest first, like the editor, and draws them in every tool', async () => {
    routes.onPage = () =>
      json(
        onPage({
          // Newest first, as Zap answers.
          comments: [
            thread('c', '2026-10-04T12:00:00.000Z', [titleAnchor]),
            thread('b', '2026-10-04T11:00:00.000Z', [spot, titleAnchor]),
            thread('a', '2026-10-04T10:00:00.000Z', [titleAnchor]),
          ],
        }),
      )
    await ready()
    // Navegar: pins, nothing intercepted.
    expect((await drawnPins()).map((pin) => pin.textContent).sort()).toEqual(['1', '2', '3'])
    action('open-list').click()
    const items = Array.from(root().querySelectorAll('[data-comment]'))
    expect(
      items.map((item) => [
        item.getAttribute('data-comment'),
        item.querySelector('.num')?.textContent,
      ]),
    ).toEqual([
      ['c', '3'],
      ['b', '2'],
      ['a', '1'],
    ])
    tool('comment').click()
    expect(await drawnPins()).toHaveLength(3)
  })

  it('a pin is a number set as text, and opens its comment', async () => {
    await ready()
    const [pin] = await drawnPins()
    expect(pin!.textContent).toBe('1')
    expect(pin!.children).toHaveLength(0)
    pin!.click()
    expect(root().textContent).toContain('Ana Rodríguez')
    expect(root().textContent).toContain('Nombrar las fincas')
  })

  it('stored selectors that cannot parse, or match nothing, place no pin and throw nothing', async () => {
    routes.onPage = () =>
      json(
        onPage({
          comments: [
            thread('bad', '2026-10-04T10:00:00.000Z', [
              { fieldKey: null, tag: null, selector: ')(*&^', rect: null, spot: null },
              { fieldKey: null, tag: 'not a tag', selector: '#nope', rect: null, spot: null },
            ]),
          ],
        }),
      )
    await ready()
    expect(await drawnPins()).toHaveLength(0)
    expect(root().textContent).toContain('1 abierto')
  })

  it('markup in names, excerpts and labels shows literally, never as elements', async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>'
    routes.onPage = () =>
      json(
        onPage({
          viewer: { name: '<b>Mallory</b> X' },
          fields: {
            'blog/hola': { ...FIELDS['blog/hola'], title: { type: 'TEXT', label: '<i>T</i>' } },
          },
          comments: [
            {
              ...thread('x', '2026-10-04T10:00:00.000Z', [titleAnchor]),
              author: { name: evil },
              excerpt: evil,
            },
          ],
        }),
      )
    routes.create = () => created(evil)
    await ready()
    tool('comment').click()
    click($('h1'))
    expect(popover()!.querySelector('.chip')!.textContent).toBe('<i>T</i>')
    action('request-change').click()
    type(textarea(), 'x')
    sendButton().click()
    await tick()
    action('open-list').click()
    const shadow = root()
    expect(shadow.querySelector('img, script, b, i')).toBeNull()
    expect(shadow.textContent).toContain(evil)
    expect(overlayRoot().querySelector('img, script, b, i')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    // The name reaches the bar only as the account chip's accessible name, as text.
    expect(action('account').getAttribute('aria-label')).toBe('<b>Mallory</b> X, cuenta')
    expect(byText(shadow, evil, 'span')).not.toBeNull()
  })
})
