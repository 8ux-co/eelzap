import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Overlay } from '../overlay'
import { MAX_TAGGED } from '../tags'
import type { OnPage } from './api'
import type { SiteContext, StartOptions } from './config'
import { BAR_STORAGE_KEY } from './drag'
import { captureShadowRoots, tick } from './spec-helpers'
import { start } from './suggest'
import { readToken, writeToken } from './token'

/**
 * The bar of the `suggest` chunk after the SitioBarraEstados pass (item 9b and
 * its follow-ups 36 and 37): the toolbar's order with the account chip in
 * Salir's place, the account menu and its keyboard, hiding into the pill and
 * back (the arrow, the pill, Shift Z), the hidden state remembered with the
 * bar's place, the runaway guard's paused card, the «en …» suffix of fields
 * of another record (`records`), and the eye-off hide icon.
 */

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCESS = 'eel_at_ABCDEFGHIJKL_0123456789'
const ZAP = 'https://zap.eel.software'
const EDITOR_URL = `${ZAP}/w/acme/s/main/collections/c1/items/i1`

const PAGE = `
  <header>
    <h2 data-zap="doc:inicio#boletin_titulo">Te avisamos cuando llegue un lote nuevo</h2>
  </header>
  <article data-zap-entry="blog/hola">
    <h1 data-zap="blog/hola#title">Cosecha de octubre</h1>
    <p id="plain">Texto sin etiqueta</p>
  </article>`

function onPage(overrides: Partial<OnPage> = {}): OnPage {
  return {
    viewer: { name: 'Camila Restrepo', email: 'camila@ejemplo.com', editorUrl: EDITOR_URL },
    liveEditing: true,
    fields: {
      'blog/hola': { title: { type: 'TEXT', label: 'Título' } },
      'doc:inicio': { boletin_titulo: { type: 'TEXT', label: 'Boletín: título' } },
    },
    records: { 'doc:inicio': 'Inicio' },
    comments: [
      {
        id: 'r1',
        status: 'OPEN',
        isChangeRequest: false,
        createdAt: '2026-10-04T10:00:00.000Z',
        author: { name: 'Ana Rodríguez' },
        excerpt: 'Revisar',
        anchors: [
          { fieldKey: 'title', tag: 'blog/hola#title', selector: null, rect: null, spot: null },
        ],
      },
      {
        id: 'r2',
        status: 'OPEN',
        isChangeRequest: false,
        createdAt: '2026-10-04T11:00:00.000Z',
        author: { name: 'Ana Rodríguez' },
        excerpt: 'Otra',
        anchors: [
          { fieldKey: 'title', tag: 'blog/hola#title', selector: null, rect: null, spot: null },
        ],
      },
    ],
    truncated: false,
    ...overrides,
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

let answer: () => OnPage
let fetchMock: ReturnType<typeof vi.fn>
let shadows: ReturnType<typeof captureShadowRoots>
let handle: { destroy(): void } | null = null
let ctx: SiteContext

function boot(
  locale: 'es' | 'en' = 'es',
  options: StartOptions = {},
  shortcut: string | false = 'Z',
) {
  ctx = {
    win: window,
    doc: document,
    siteId: SITE,
    zapOrigin: ZAP,
    authOrigin: 'https://auth.eel.software',
    clientId: `${ZAP}/oauth/clients/${SITE}.json`,
    redirectUri: `${window.location.origin}/`,
    locale,
    shortcut,
    draftRoute: '/api/zap-preview',
    open: vi.fn(async () => {}),
    close: vi.fn(),
  }
  handle = start(ctx, options)
}

async function ready(locale: 'es' | 'en' = 'es', shortcut: string | false = 'Z') {
  boot(locale, {}, shortcut)
  await tick()
}

const root = () => shadows.current()
const action = (name: string) => root().querySelector(`[data-action="${name}"]`) as HTMLElement
const tool = (name: 'navigate' | 'edit' | 'comment') =>
  root().querySelector(`[data-mode="${name}"]`) as HTMLButtonElement
const focused = () => root().activeElement?.getAttribute('data-action') ?? null
const $ = (selector: string) => document.querySelector(selector) as HTMLElement
const menu = () => root().querySelector('.menu') as HTMLElement | null
const items = () => Array.from(root().querySelectorAll<HTMLElement>('.menu [role="menuitem"]'))

function key(k: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}
const shiftZ = (target: EventTarget = document.body) => key('Z', target, { shiftKey: true })
/** A keyboard activation: a click whose `detail` is 0. */
const keyboardClick = (element: HTMLElement) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 0 }))
const pointerClick = (element: HTMLElement) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }))

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(null, '', '/blog/hola')
  document.body.innerHTML = PAGE
  writeToken(window, { token: ACCESS, exp: Date.now() + 3_600_000, site: SITE })
  shadows = captureShadowRoots()
  answer = () => onPage()
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/comments/on-page')) return json(answer())
    if (url.endsWith('/comments/save-to-draft')) {
      return json({ thread: { id: 't' }, draftVersionId: 'v' }, 201)
    }
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

describe('the toolbar (SitioBarraEstados)', () => {
  it('reads grip, divider, bolt, tools, divider, open count, divider, account chip, hide arrow', async () => {
    await ready()
    const toolbar = root().querySelector('[role="toolbar"]')!
    const parts = Array.from(toolbar.children, (node) => {
      if (node.getAttribute('role') === 'group') return 'tools'
      if (node.classList.contains('divider')) return '|'
      if (node.classList.contains('icon')) return 'bolt'
      // The hide arrow sits inside its tooltip wrapper.
      const named =
        node.getAttribute('data-action') ??
        node.querySelector('[data-action]')?.getAttribute('data-action')
      return named ?? node.localName
    })
    expect(parts).toEqual([
      expect.stringMatching(/grip|move|button/),
      '|',
      'bolt',
      'tools',
      '|',
      'open-list',
      '|',
      'account',
      'hide',
    ])
    // Salir is gone from the bar: signing out lives in the account menu.
    expect(toolbar.querySelector('[data-action="exit"]')).toBeNull()
    expect(toolbar.textContent).not.toMatch(/Salir|Sign out/)
  })

  it.each([
    ['es', 'Camila Restrepo, cuenta', 'Ocultar barra'],
    ['en', 'Camila Restrepo, account', 'Hide the bar'],
  ] as const)('the account chip and the hide arrow are named in %s', async (locale, chip, hide) => {
    await ready(locale)
    const account = action('account')
    expect(account.getAttribute('aria-haspopup')).toBe('menu')
    expect(account.getAttribute('aria-expanded')).toBe('false')
    expect(account.getAttribute('aria-label')).toBe(chip)
    expect(action('hide').getAttribute('aria-label')).toBe(hide)
    const other = locale === 'es' ? /account|Hide the bar/ : /cuenta|Ocultar/
    expect(account.getAttribute('aria-label')).not.toMatch(other)
    expect(action('hide').getAttribute('aria-label')).not.toMatch(other)
  })

  it('without a name yet, the chip says «Cuenta»', async () => {
    answer = () => onPage({ viewer: { name: null } })
    await ready()
    expect(action('account').getAttribute('aria-label')).toBe('Cuenta')
  })

  it('the hide arrow draws Lucide eye-off', async () => {
    await ready()
    const svg = action('hide').querySelector('svg')!
    // The eye-off slash, unique to that icon among the bar's glyphs.
    expect(svg.innerHTML).toContain('m2 2 20 20')
  })
})

describe('the account menu', () => {
  it('a pointer opens it onto the menu itself; the chip says it is expanded', async () => {
    await ready()
    pointerClick(action('account'))
    expect(menu()).not.toBeNull()
    expect(menu()!.getAttribute('role')).toBe('menu')
    expect(action('account').getAttribute('aria-expanded')).toBe('true')
    expect(focused()).toBe('menu')
    expect(items().map((item) => item.textContent)).toEqual([
      'Abrir en Zap',
      'Cerrar sesión en Zap',
    ])
    expect(root().querySelectorAll('.menu [role="separator"]').length).toBeGreaterThan(0)
  })

  it('the keyboard (Enter or Space) opens it onto the first item', async () => {
    await ready()
    keyboardClick(action('account'))
    expect(focused()).toBe('open-zap')
  })

  it('ArrowDown on the chip opens onto the first item, ArrowUp onto the last', async () => {
    await ready()
    key('ArrowDown', action('account'))
    expect(focused()).toBe('open-zap')
    key('Escape', root().activeElement!)
    key('ArrowUp', action('account'))
    expect(focused()).toBe('sign-out')
  })

  it('arrows wrap; Home and End jump to the ends', async () => {
    await ready()
    keyboardClick(action('account'))
    key('ArrowDown', root().activeElement!)
    expect(focused()).toBe('sign-out')
    key('ArrowDown', root().activeElement!)
    expect(focused()).toBe('open-zap')
    key('ArrowUp', root().activeElement!)
    expect(focused()).toBe('sign-out')
    key('Home', root().activeElement!)
    expect(focused()).toBe('open-zap')
    key('End', root().activeElement!)
    expect(focused()).toBe('sign-out')
  })

  it('Escape closes it and returns focus to the chip', async () => {
    await ready()
    keyboardClick(action('account'))
    key('Escape', root().activeElement!)
    expect(menu()).toBeNull()
    expect(focused()).toBe('account')
    expect(action('account').getAttribute('aria-expanded')).toBe('false')
  })

  it('Tab closes it', async () => {
    await ready()
    keyboardClick(action('account'))
    key('Tab', root().activeElement!)
    expect(menu()).toBeNull()
  })

  it('a press on the page closes it', async () => {
    await ready()
    pointerClick(action('account'))
    $('#plain').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(menu()).toBeNull()
  })

  it('shows the email line only when the viewer has one', async () => {
    await ready()
    pointerClick(action('account'))
    expect(menu()!.textContent).toContain('camila@ejemplo.com')
    handle?.destroy()
    answer = () => onPage({ viewer: { name: 'Camila Restrepo' } })
    await ready()
    pointerClick(action('account'))
    expect(menu()!.querySelector('.menu-mail')).toBeNull()
  })

  it('«Abrir en Zap» opens the record’s editor with noopener', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await ready()
    keyboardClick(action('account'))
    action('open-zap').click()
    expect(open).toHaveBeenCalledWith(EDITOR_URL, '_blank', 'noopener')
  })

  it('«Cerrar sesión en Zap» forgets the token and closes the bar', async () => {
    await ready()
    keyboardClick(action('account'))
    action('sign-out').click()
    expect(readToken(window, SITE)).toBeNull()
    expect(ctx.close).toHaveBeenCalled()
  })
})

describe('hiding into the pill (the arrow, the pill, Shift Z)', () => {
  it('the arrow folds the bar into the pill with the open count; focus follows', async () => {
    await ready()
    action('hide').click()
    expect(root().querySelector('[role="toolbar"]')).toBeNull()
    const pill = action('show')
    expect(pill.textContent).toContain('2')
    expect(pill.getAttribute('aria-label')).toBe('Mostrar la barra de Zap, 2 abiertos')
    expect(focused()).toBe('show')
  })

  it('the pill’s label speaks English, with the singular, and «N+» when truncated', async () => {
    answer = () => ({ ...onPage(), comments: onPage().comments.slice(0, 1), truncated: true })
    await ready('en')
    action('hide').click()
    expect(action('show').getAttribute('aria-label')).toBe('Show the Zap bar, 1+ open')
    expect(action('show').textContent).toContain('1+')
  })

  it('the pill brings the bar back, focus on the hide arrow', async () => {
    await ready()
    action('hide').click()
    action('show').click()
    expect(root().querySelector('[role="toolbar"]')).not.toBeNull()
    expect(focused()).toBe('hide')
  })

  it('Shift Z from the page toggles bar and pill without taking focus', async () => {
    await ready()
    shiftZ()
    expect(action('show')).not.toBeNull()
    expect(root().activeElement).toBeNull()
    shiftZ()
    expect(root().querySelector('[role="toolbar"]')).not.toBeNull()
  })

  it('Shift Z does nothing while a field is being edited in place', async () => {
    await ready()
    tool('edit').click()
    const h1 = $('h1')
    h1.click()
    expect(h1.getAttribute('contenteditable')).not.toBeNull()
    shiftZ(h1)
    expect(root().querySelector('[role="toolbar"]')).not.toBeNull()
  })

  it('Shift Z does nothing while a comment is being written', async () => {
    await ready()
    tool('comment').click()
    $('h1').click()
    expect(root().querySelector('textarea.composer')).not.toBeNull()
    shiftZ()
    expect(root().querySelector('[role="toolbar"]')).not.toBeNull()
  })

  it('with the shortcut off, Shift Z does nothing', async () => {
    await ready('es', false)
    shiftZ()
    expect(root().querySelector('[role="toolbar"]')).not.toBeNull()
  })

  it('hiding ends the tool’s grip on the page: Editar intercepts nothing while hidden', async () => {
    await ready()
    tool('edit').click()
    action('hide').click()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    $('h1').dispatchEvent(event)
    expect($('h1').hasAttribute('contenteditable')).toBe(false)
  })
})

describe('the hidden state is remembered with the bar’s place (`eelzap:bar`)', () => {
  it('hiding stores hidden: true; showing drops it', async () => {
    await ready()
    action('hide').click()
    expect(JSON.parse(localStorage.getItem(BAR_STORAGE_KEY)!)).toMatchObject({ hidden: true })
    action('show').click()
    expect(localStorage.getItem(BAR_STORAGE_KEY)).toBeNull()
  })

  it('keeps the saved place beside it', async () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 40, y: 50 }))
    await ready()
    action('hide').click()
    expect(JSON.parse(localStorage.getItem(BAR_STORAGE_KEY)!)).toEqual({
      x: 40,
      y: 50,
      hidden: true,
    })
  })

  it('a page loaded with hidden: true starts as the pill', async () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ hidden: true }))
    await ready()
    expect(action('show')).not.toBeNull()
    expect(root().querySelector('[role="toolbar"]')).toBeNull()
  })

  it('blocked storage: the bar still hides and shows', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    writeToken(window, { token: ACCESS, exp: Date.now() + 3_600_000, site: SITE })
    // The token itself lives in sessionStorage; give it back for this test.
    vi.mocked(Storage.prototype.getItem).mockImplementation(function (this: Storage, k: string) {
      if (this === sessionStorage && k === 'eelzap:site-token') {
        return JSON.stringify({ token: ACCESS, exp: Date.now() + 3_600_000, site: SITE })
      }
      throw new DOMException('blocked', 'SecurityError')
    })
    await ready()
    action('hide').click()
    expect(action('show')).not.toBeNull()
    action('show').click()
    expect(root().querySelector('[role="toolbar"]')).not.toBeNull()
  })
})

describe('the runaway guard’s paused card', () => {
  function overCap() {
    const many = Array.from(
      { length: MAX_TAGGED + 1 },
      (_, i) => `<span data-zap="blog/hola#f${i}">x</span>`,
    ).join('')
    document.body.innerHTML = `<article>${many}</article>`
  }

  it('a page over the cap at boot: «Vista previa pausada», the cap line, Editar and Comentar off', async () => {
    overCap()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ready()
    const card = root().querySelector('.paused')!
    expect(card.getAttribute('role')).toBe('status')
    expect(card.textContent).toContain('Vista previa pausada')
    expect(card.textContent).toContain('La página tiene demasiados campos para seguirlos.')
    expect(tool('edit').getAttribute('aria-disabled')).toBe('true')
    expect(tool('comment').getAttribute('aria-disabled')).toBe('true')
    expect(tool('edit').getAttribute('data-tip')).toBe('Vista previa pausada')
    tool('edit').click()
    expect(tool('navigate').getAttribute('aria-pressed')).toBe('true')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('«Recargar» reloads the page', async () => {
    overCap()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: window.location.href,
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: '',
      hash: '',
      reload,
    } as unknown as Location)
    await ready()
    action('reload').click()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['es', '. Vista previa pausada'],
    ['en', '. Preview paused'],
  ] as const)('the pill’s label carries the pause in %s', async (locale, suffix) => {
    overCap()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ready(locale)
    action('hide').click()
    expect(action('show').getAttribute('aria-label')!.endsWith(suffix)).toBe(true)
  })
})

describe('fields of another record (`records`, item 37)', () => {
  it('labels own fields by key and foreign ones by tag with «en {name}»', async () => {
    const setLabels = vi.spyOn(Overlay.prototype, 'setLabels')
    await ready()
    const [labels, foreign] = setLabels.mock.calls.at(-1)!
    expect(labels).toEqual({ title: 'Título' })
    expect(foreign).toEqual({ 'doc:inicio#boletin_titulo': ['Boletín: título', 'en Inicio'] })
  })

  it('in English the suffix reads «in {name}»', async () => {
    const setLabels = vi.spyOn(Overlay.prototype, 'setLabels')
    await ready('en')
    expect(setLabels.mock.calls.at(-1)![1]).toEqual({
      'doc:inicio#boletin_titulo': ['Boletín: título', 'in Inicio'],
    })
  })

  it('without records every label is own (an older Zap, or a page that is no record)', async () => {
    const setLabels = vi.spyOn(Overlay.prototype, 'setLabels')
    answer = () => onPage({ records: undefined })
    await ready()
    expect(setLabels.mock.calls.at(-1)).toEqual([
      { title: 'Título', boletin_titulo: 'Boletín: título' },
      {},
    ])
  })

  it('an edit on a field of another record saves to that record', async () => {
    await ready()
    tool('edit').click()
    const h2 = $('h2')
    h2.click()
    h2.firstChild!.textContent = 'Te avisamos pronto'
    h2.dispatchEvent(new Event('input', { bubbles: true }))
    h2.dispatchEvent(new FocusEvent('blur'))
    await tick()
    const [, init] = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/save-to-draft'),
    )! as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.document).toBe('inicio')
    expect(body.collection).toBeUndefined()
    expect(body.proposedValues).toEqual([
      { fieldKey: 'boletin_titulo', value: 'Te avisamos pronto' },
    ])
  })
})
