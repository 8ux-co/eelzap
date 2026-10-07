import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OnPage } from './api'
import type { SiteContext } from './config'
import { DRAFT_SESSION_KEY, EDIT_INTENT_KEY } from './draft-session'
import { captureShadowRoots, tick } from './spec-helpers'
import { start } from './suggest'
import { writeToken } from './token'

/**
 * «Editar» per field type on the live site (zap-cms-v2 §3.4; boards
 * SitioEditarOpcion, Numero, SiNo, SitioEditarEnZap), through `start(ctx)`
 * against a faked Zap: the editor each type gets, what a save sends, the
 * second edit without a reload, the reload after a formatted value, 409
 * NO_CHANGE, an outside press, focus, «Este campo se edita en Zap», the
 * card's placement around the bar, the draft-session retry and the key caps.
 */

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCESS = 'eel_at_ABCDEFGHIJKL_0123456789'
const ZAP = 'https://zap.eel.software'
const ROUTE = '/api/zap-preview'
const REF = 'cafes/finca'
const DOC = 'doc:configuracion'
const OWN_EDITOR = `${ZAP}/s/demo/items/cafes/finca`
const DOC_EDITOR = `${ZAP}/s/demo/documents/configuracion`
/** `RELOAD_AFTER_SAVE_MS` in suggest.ts. */
const RELOAD_MS = 700

const PAGE = `
  <article data-zap-entry="${REF}">
    <h1 id="nombre" data-zap="${REF}#nombre">Finca La Plata</h1>
    <span id="estado" data-zap="${REF}#estado">Disponible</span>
    <span id="altitud" data-zap="${REF}#altitud">1.750 msnm</span>
    <span id="precio" data-zap="${REF}#precio">US$ 12,50</span>
    <span id="organico" data-zap="${REF}#organico">Sí</span>
    <div id="historia" data-zap="${REF}#historia">Una historia larga</div>
    <button id="before" type="button">Antes</button>
  </article>
  <footer data-zap-entry="${DOC}">
    <div id="aviso" data-zap="${DOC}#aviso">Aviso legal</div>
  </footer>`

const OPTIONS = [
  { id: 'disponible', label: 'Disponible' },
  { id: 'agotado', label: 'Agotado' },
  { id: 'pronto', label: 'Pronto' },
]

function onPage(overrides: Partial<OnPage> = {}): OnPage {
  return {
    viewer: { name: 'Camila Restrepo', editorUrl: OWN_EDITOR },
    liveEditing: true,
    fields: {
      [REF]: {
        nombre: { type: 'TEXT', label: 'Nombre' },
        estado: { type: 'ENUM', label: 'Estado', options: OPTIONS },
        altitud: { type: 'INTEGER', label: 'Altitud', min: 0, max: 5000 },
        precio: { type: 'CURRENCY', label: 'Precio', currency: 'USD' },
        organico: { type: 'BOOLEAN', label: 'Orgánico' },
        historia: { type: 'RICH_TEXT', label: 'Historia' },
      },
      [DOC]: { aviso: { type: 'RICH_TEXT', label: 'Aviso' } },
    },
    values: {
      [REF]: { estado: 'disponible', altitud: 1750, precio: 1250, organico: true },
    },
    records: { [DOC]: 'Configuración' },
    editorUrls: { [DOC]: DOC_EDITOR },
    comments: [],
    truncated: false,
    ...overrides,
  }
}

type Route = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: { onPage: Route; draft: Route; session: Route }
let fetchMock: ReturnType<typeof vi.fn>
let shadows: ReturnType<typeof captureShadowRoots>
let handle: { destroy(): void } | null = null
let reload: ReturnType<typeof vi.fn>

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function mockLocation() {
  const real = window.location
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
    assign: vi.fn(),
    reload,
    replace: vi.fn(),
  } as unknown as Location)
}

async function ready() {
  const ctx: SiteContext = {
    win: window,
    doc: document,
    siteId: SITE,
    zapOrigin: ZAP,
    authOrigin: 'https://auth.eel.software',
    clientId: `${ZAP}/oauth/clients/${SITE}.json`,
    redirectUri: `${window.location.origin}/`,
    locale: 'es',
    shortcut: 'Z',
    draftRoute: ROUTE,
    open: vi.fn(async () => {}),
    close: vi.fn(),
  }
  handle = start(ctx)
  await tick()
  await tick()
}

const root = () => shadows.current()
const tool = (name: 'navigate' | 'edit' | 'comment') =>
  root().querySelector(`[data-mode="${name}"]`) as HTMLButtonElement
const action = (name: string) => root().querySelector(`[data-action="${name}"]`) as HTMLElement
const $ = (selector: string) => document.querySelector(selector) as HTMLElement
const editor = () => root().querySelector('.card.editor') as HTMLElement | null
const infoCard = () => root().querySelector('.card.info') as HTMLElement | null
const valueInput = () => root().querySelector('input.value') as HTMLInputElement
const options = () => Array.from(root().querySelectorAll('[role="option"]')) as HTMLElement[]
const option = (label: string) => options().find((o) => o.textContent === label)!
const toggle = () => root().querySelector('[role="switch"]') as HTMLElement

function click(element: Element) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
  element.dispatchEvent(event)
  return event
}
function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const key = (k: string, target: EventTarget = window) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true }),
  )
const press = (target: EventTarget) =>
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
const posts = () =>
  (fetchMock.mock.calls as Array<[string, RequestInit]>)
    .filter(([url, init]) => init.method === 'POST' && url.endsWith('/comments/save-to-draft'))
    .map(([, init]) => JSON.parse(String(init.body)))
const sessionPosts = () =>
  (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(
    ([url, init]) => url.endsWith('/api/public/v1/preview/session') && init.method === 'POST',
  )

async function edit(selector: string) {
  await ready()
  click(tool('edit'))
  click($(selector))
}

beforeEach(() => {
  // Real time drives the fake clock (`tick` keeps working); a reload timer
  // left by one test is dropped with the fake clock, never fired in the next.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(null, '', '/cafes/finca')
  document.body.innerHTML = PAGE
  writeToken(window, { token: ACCESS, exp: Date.now() + 3_600_000, site: SITE })
  mockLocation()
  shadows = captureShadowRoots()
  routes = {
    onPage: () => json(onPage()),
    draft: () => json({ thread: { id: 't' }, draftVersionId: 'v' }, 201),
    session: () => new Promise<Response>(() => {}),
  }
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/comments/on-page')) return routes.onPage(url, init)
    if (url.endsWith('/comments/save-to-draft')) return routes.draft(url, init)
    if (url.endsWith('/preview/session')) return routes.session(url, init)
    throw new Error(`unexpected ${url}`)
  })
  vi.spyOn(window, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch)
})

afterEach(() => {
  handle?.destroy()
  handle = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ENUM: a list of its options', () => {
  it('one option per entry, the current one selected and focused, the Enter / Esc footer in key caps', async () => {
    await edit('#estado')
    expect(root().querySelector('[role="listbox"]')!.getAttribute('aria-label')).toBe(
      'Opciones de Estado',
    )
    expect(options().map((o) => o.textContent)).toEqual(['Disponible', 'Agotado', 'Pronto'])
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ])
    expect(root().activeElement).toBe(option('Disponible'))
    const keys = editor()!.querySelector('.keys')!
    expect(Array.from(keys.querySelectorAll('kbd'), (k) => k.textContent)).toEqual(['Enter', 'Esc'])
    expect(keys.textContent).toBe('EnterguardaEsccancela')
  })

  it('ArrowDown and ArrowUp move focus between options', async () => {
    await edit('#estado')
    key('ArrowDown', option('Disponible'))
    expect(root().activeElement).toBe(option('Agotado'))
    key('ArrowDown', option('Agotado'))
    expect(root().activeElement).toBe(option('Pronto'))
    key('ArrowUp', option('Pronto'))
    expect(root().activeElement).toBe(option('Agotado'))
  })

  it("a click on another option saves its id, with the option's label as the body", async () => {
    await edit('#estado')
    click(option('Agotado'))
    await tick()
    const [body] = posts()
    expect(body).toMatchObject({
      collection: 'cafes',
      slug: 'finca',
      body: 'Agotado',
      proposedValues: [{ fieldKey: 'estado', value: 'agotado' }],
    })
    expect(editor()).toBeNull()
  })

  it('the same option saves nothing', async () => {
    await edit('#estado')
    click(option('Disponible'))
    await tick()
    expect(posts()).toEqual([])
    expect(editor()).toBeNull()
  })
})

describe('INTEGER: a number input on the stored value', () => {
  it('type number, step 1, the limits, the value from `values` (not «1.750 msnm»); Enter saves', async () => {
    await edit('#altitud')
    const input = valueInput()
    expect(input.type).toBe('number')
    expect(input.getAttribute('step')).toBe('1')
    expect(input.getAttribute('min')).toBe('0')
    expect(input.getAttribute('max')).toBe('5000')
    expect(input.value).toBe('1750')
    expect(root().activeElement).toBe(input)
    type(input, '1760')
    key('Enter', input)
    await tick()
    const [body] = posts()
    expect(body.proposedValues).toEqual([{ fieldKey: 'altitud', value: 1760 }])
    expect(body.body).toBe('1760')
  })

  it('Escape cancels: no save, the editor closes', async () => {
    await edit('#altitud')
    type(valueInput(), '1760')
    key('Escape', valueInput())
    await tick()
    expect(posts()).toEqual([])
    expect(editor()).toBeNull()
  })
})

describe('CURRENCY: major units on screen, minor units saved', () => {
  it('1250 USD shows as 12.50 with the code beside it; 13.75 saves 1375', async () => {
    await edit('#precio')
    const input = valueInput()
    expect(input.value).toBe('12.50')
    expect(input.getAttribute('step')).toBe('0.01')
    expect(editor()!.querySelector('.with-unit')!.textContent).toBe('USD')
    type(input, '13.75')
    key('Enter', input)
    await tick()
    expect(posts()[0]!.proposedValues).toEqual([{ fieldKey: 'precio', value: 1375 }])
  })
})

describe('BOOLEAN: a switch', () => {
  it('role=switch on the stored value; a click flips it; Enter saves false as «No»', async () => {
    await edit('#organico')
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    click(toggle())
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    key('Enter', toggle())
    await tick()
    const [body] = posts()
    expect(body.proposedValues).toEqual([{ fieldKey: 'organico', value: false }])
    expect(body.body).toBe('No')
  })

  it('false flipped on saves true as «Sí»', async () => {
    routes.onPage = () => json(onPage({ values: { [REF]: { organico: false } } }))
    await edit('#organico')
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    click(toggle())
    key('Enter', toggle())
    await tick()
    const [body] = posts()
    expect(body.proposedValues).toEqual([{ fieldKey: 'organico', value: true }])
    expect(body.body).toBe('Sí')
  })
})

describe('a second edit without a reload', () => {
  it('an ENUM tagged by attribute on text: the label is written in place, no reload, and the next editor opens on the saved value', async () => {
    await edit('#estado')
    click(option('Agotado'))
    await tick()
    expect(posts()).toHaveLength(1)
    expect($('#estado').textContent).toBe('Agotado')
    await vi.advanceTimersByTimeAsync(RELOAD_MS * 2)
    expect(reload).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(EDIT_INTENT_KEY)).toBeNull()

    click($('#estado'))
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ])
    // Picking it again is no change.
    click(option('Agotado'))
    await tick()
    expect(posts()).toHaveLength(1)
  })
})

describe('the reload after a value the site formats', () => {
  it('INTEGER: remembers the edit intent and reloads after RELOAD_AFTER_SAVE_MS', async () => {
    await edit('#altitud')
    type(valueInput(), '1760')
    key('Enter', valueInput())
    await tick()
    expect(posts()).toHaveLength(1)
    expect(JSON.parse(sessionStorage.getItem(EDIT_INTENT_KEY)!)).toMatchObject({
      path: '/cafes/finca',
    })
    expect(reload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RELOAD_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('409 from save-to-draft', () => {
  async function saveTitle() {
    await edit('#nombre')
    const h1 = $('#nombre')
    h1.firstChild!.textContent = 'Finca La Plata Alta'
    h1.dispatchEvent(new Event('input', { bubbles: true }))
    key('Enter', h1)
    await tick()
    await tick()
    expect(posts()).toHaveLength(1)
  }

  it('NO_CHANGE: no error toast, nothing reverted', async () => {
    routes.draft = () => json({ error: { code: 'NO_CHANGE', message: 'Sin cambios' } }, 409)
    await saveTitle()
    expect(root().querySelector('.toast-error')).toBeNull()
    expect($('#nombre').textContent).toBe('Finca La Plata Alta')
  })

  it('another 409: the save-failed toast, and the text goes back', async () => {
    routes.draft = () => json({ error: { code: 'DUPLICATE', message: 'Repetido' } }, 409)
    await saveTitle()
    const toast = root().querySelector('.toast-error')
    expect(toast?.querySelector('.title')?.textContent).toBe(
      'No se pudo guardar. El texto volvió a como estaba.',
    )
    expect($('#nombre').textContent).toBe('Finca La Plata')
  })
})

describe('leaving the editor', () => {
  it('a press on the page outside commits the open editor', async () => {
    await edit('#altitud')
    type(valueInput(), '1760')
    press(document.body)
    await tick()
    expect(posts().map((body) => body.proposedValues)).toEqual([
      [{ fieldKey: 'altitud', value: 1760 }],
    ])
    expect(editor()).toBeNull()
  })

  it('focus goes back to what had it before the editor opened', async () => {
    await ready()
    click(tool('edit'))
    $('#before').focus()
    expect(document.activeElement).toBe($('#before'))
    click($('#altitud'))
    expect(root().activeElement).toBe(valueInput())
    key('Escape', valueInput())
    expect(editor()).toBeNull()
    expect(document.activeElement).toBe($('#before'))
  })
})

describe('«Este campo se edita en Zap» (a RICH_TEXT field)', () => {
  it('a quiet card, not an error: the title and «Historia es texto con formato…»', async () => {
    await edit('#historia')
    const card = infoCard()!
    expect(card).not.toBeNull()
    expect(card.querySelector('.title')!.textContent).toBe('Este campo se edita en Zap')
    expect(card.querySelector('.muted')!.textContent).toBe(
      'Historia es texto con formato. Cámbialo en el editor de la entrada.',
    )
    expect(root().querySelector('.toast-error')).toBeNull()
    expect(root().querySelector('.toast')).toBeNull()
    expect(card.querySelector('.error')).toBeNull()
    expect(editor()).toBeNull()
    expect(posts()).toEqual([])
  })

  it('a document field says «del documento»', async () => {
    await edit('#aviso')
    expect(infoCard()!.querySelector('.muted')!.textContent).toBe(
      'Aviso es texto con formato. Cámbialo en el editor del documento.',
    )
  })

  it('«Abrir en Zap» opens the owning record from `editorUrls`, at the field', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await edit('#aviso')
    click(infoCard()!.querySelector('[data-action="open-field"]')!)
    expect(open).toHaveBeenCalledWith(`${DOC_EDITOR}?field=aviso`, '_blank', 'noopener')
    expect(infoCard()).toBeNull()
  })

  it("the page's own record without `editorUrls` falls back to `viewer.editorUrl`", async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await edit('#historia')
    expect(infoCard()!.textContent).toContain('Abrir en Zap')
    click(infoCard()!.querySelector('[data-action="open-field"]')!)
    expect(open).toHaveBeenCalledWith(`${OWN_EDITOR}?field=historia`, '_blank', 'noopener')
  })

  it('«Comentar» switches to Comentar with the composer on the field', async () => {
    await edit('#historia')
    click(infoCard()!.querySelector('[data-action="comment-field"]')!)
    expect(infoCard()).toBeNull()
    expect(tool('comment').getAttribute('aria-pressed')).toBe('true')
    expect(root().querySelector('textarea.composer')).not.toBeNull()
  })

  it('Escape closes it', async () => {
    await edit('#historia')
    key('Escape')
    expect(infoCard()).toBeNull()
  })

  it('a press outside closes it', async () => {
    await edit('#historia')
    press(document.body)
    expect(infoCard()).toBeNull()
  })
})

describe('placement beside the element, clear of the bar', () => {
  type Box = { left: number; top: number; right: number; bottom: number }
  const rect = ({ left, top, right, bottom }: Box) =>
    ({
      left,
      top,
      right,
      bottom,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      toJSON: () => ({}),
    }) as DOMRect
  const CARD_H = 100
  const CARD_W = 300

  async function infoAt(element: Box, bar: Box | null) {
    await ready()
    click(tool('edit'))
    const target = $('#historia')
    const original = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === target) return rect(element)
      if (bar && this.classList.contains('toolbar')) return rect(bar)
      return original.call(this)
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('card') && !this.classList.contains('toolbar') ? CARD_H : 0
    })
    click(target)
    const card = infoCard()!
    return { left: parseFloat(card.style.left), top: parseFloat(card.style.top) }
  }
  const overlaps = (at: { left: number; top: number }, bar: Box) =>
    at.left < bar.right &&
    at.left + CARD_W > bar.left &&
    at.top < bar.bottom &&
    at.top + CARD_H > bar.top

  it('10px under the element by default', async () => {
    const at = await infoAt(
      { left: 100, top: 200, right: 400, bottom: 220 },
      { left: 300, top: 700, right: 700, bottom: 740 },
    )
    expect(at).toEqual({ left: 100, top: 230 })
  })

  it('the bar right under the element: the card shifts sideways past it', async () => {
    const bar = { left: 300, top: 560, right: 700, bottom: 600 }
    const at = await infoAt({ left: 400, top: 500, right: 600, bottom: 520 }, bar)
    expect(at.top).toBe(530)
    expect(at.left).toBe(708)
    expect(overlaps(at, bar)).toBe(false)
  })

  it('a bar too wide to pass: the card goes above the element', async () => {
    const bar = { left: 0, top: 560, right: 1024, bottom: 600 }
    const at = await infoAt({ left: 400, top: 500, right: 600, bottom: 520 }, bar)
    expect(at).toEqual({ left: 400, top: 500 - CARD_H - 10 })
    expect(overlaps(at, bar)).toBe(false)
  })

  it('no clear spot: the first that fits the viewport wins (below)', async () => {
    const bar = { left: 0, top: 100, right: 1024, bottom: 700 }
    const at = await infoAt({ left: 50, top: 300, right: 400, bottom: 320 }, bar)
    expect(at).toEqual({ left: 50, top: 330 })
  })

  it('no clear spot and no room below: above', async () => {
    const bar = { left: 0, top: 100, right: 1024, bottom: 700 }
    const at = await infoAt({ left: 50, top: 400, right: 400, bottom: 700 }, bar)
    expect(at).toEqual({ left: 50, top: 400 - CARD_H - 10 })
  })
})

describe('the draft-session retry on an untagged page', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main><h1>Finca La Plata</h1></main>'
    sessionStorage.setItem(
      DRAFT_SESSION_KEY,
      JSON.stringify({ exp: Date.now() + 600_000, origin: window.location.origin }),
    )
  })

  it('in a draft session that came back untagged: Editar asks for the session again, once', async () => {
    await ready()
    click(tool('edit'))
    await tick()
    expect(sessionPosts()).toHaveLength(1)
    expect(root().querySelector('.status')!.textContent).toBe('Preparando la edición…')
    expect(root().textContent).not.toContain('No hay campos para editar aquí')
    click(tool('edit'))
    await tick()
    expect(sessionPosts()).toHaveLength(1)
  })

  it('a load an exchange caused (edit intent): the empty state, no request', async () => {
    sessionStorage.setItem(
      EDIT_INTENT_KEY,
      JSON.stringify({ path: window.location.pathname, at: Date.now() }),
    )
    await ready()
    click(tool('edit'))
    await tick()
    expect(sessionPosts()).toEqual([])
    expect(root().querySelector('.toast .title')?.textContent).toBe(
      'No hay campos para editar aquí',
    )
  })
})

describe('key caps', () => {
  it('the bar tooltip shows Shift and Z as two key caps in a group', async () => {
    await ready()
    action('hide').dispatchEvent(new MouseEvent('mouseenter'))
    const tip = root().querySelector('.tip')!
    expect(tip.classList.contains('on')).toBe(true)
    const group = tip.querySelector('.kbd-group')!
    expect(Array.from(group.querySelectorAll('kbd'), (k) => k.textContent)).toEqual(['Shift', 'Z'])
    expect(tip.textContent).toBe('Ocultar barraShift Z')
  })

  it('the editor footer has <kbd>Enter</kbd> and <kbd>Esc</kbd>', async () => {
    await edit('#altitud')
    const caps = Array.from(editor()!.querySelectorAll('.keys > kbd'), (k) => k.textContent)
    expect(caps).toEqual(['Enter', 'Esc'])
  })

  it('the shadow stylesheet carries the Kbd rule and the group gap', async () => {
    await ready()
    const css = Array.from(root().querySelectorAll('style'), (s) => s.textContent).join('\n')
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
    expect(decls.some((d) => d.startsWith('font: 500 11px/12px '))).toBe(true)
    expect(css).toMatch(/\.kbd-group \{[^}]*gap: 2px/)
  })
})
