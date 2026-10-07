import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OVERLAY_HOST_TAG } from '../overlay'
import type { OnPage } from './api'
import type { SiteContext } from './config'
import { captureShadowRoots, tick } from './spec-helpers'
import { start } from './suggest'
import { writeToken } from './token'
import { ICONS, SITE_HOST_TAG } from './ui'

/**
 * The live site's bar (the `suggest` chunk) on the page: the hosts' layering
 * (item 14), links and forms per tool (item 18), the «no fields» empty state
 * (item 13), the hide button's icon (item 36), «en …» on another record's
 * chip, hovered in Editar (item 37), and the list scrolling to a thread
 * without `scrollIntoView`.
 */

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCESS = 'eel_at_ABCDEFGHIJKL_0123456789'
const ZAP = 'https://zap.eel.software'

const PAGE_HTML = `
  <article data-zap-entry="blog/hola">
    <h1 data-zap="blog/hola#title">Cosecha de octubre</h1>
    <p data-zap="blog/hola#summary">Así llegó la cosecha</p>
    <a id="out" href="https://ejemplo.com/otra">Otra página</a>
    <form id="form" action="/buscar"><input name="q" /><button type="submit">Buscar</button></form>
  </article>
  <footer data-zap-entry="doc:configuracion">
    <span data-zap="doc:configuracion#phone">300 123 4567</span>
  </footer>`

function onPage(overrides: Partial<OnPage> = {}): OnPage {
  return {
    viewer: { name: 'Camila Restrepo' },
    liveEditing: true,
    fields: {
      'blog/hola': {
        title: { type: 'TEXT', label: 'Título' },
        summary: { type: 'LONG_TEXT', label: 'Resumen' },
      },
      'doc:configuracion': { phone: { type: 'TEXT', label: 'Teléfono' } },
    },
    records: { 'doc:configuracion': 'Configuración' },
    comments: [
      {
        id: 'r1',
        status: 'OPEN',
        isChangeRequest: false,
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

let shadows: ReturnType<typeof captureShadowRoots>
let handle: { destroy(): void } | null = null

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

async function ready(extra: Partial<SiteContext> = {}) {
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
    open: vi.fn(async () => {}),
    close: vi.fn(),
    ...extra,
  }
  handle = start(ctx)
  await tick()
  await tick()
}

const root = () => shadows.current()
const overlayRoot = () => shadows.current(OVERLAY_HOST_TAG)
const tool = (name: 'navigate' | 'edit' | 'comment') =>
  root().querySelector(`[data-mode="${name}"]`) as HTMLButtonElement
const action = (name: string) => root().querySelector(`[data-action="${name}"]`) as HTMLElement
const $ = (selector: string) => document.querySelector(selector) as HTMLElement

function click(element: Element) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
  element.dispatchEvent(event)
  return event
}
function submit(form: HTMLFormElement) {
  const event = new Event('submit', { bubbles: true, cancelable: true })
  form.dispatchEvent(event)
  return event
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(null, '', '/blog/hola')
  document.body.innerHTML = PAGE_HTML
  writeToken(window, { token: ACCESS, exp: Date.now() + 3_600_000, site: SITE })
  shadows = captureShadowRoots()
  vi.spyOn(window, 'fetch').mockImplementation((async (url: string) => {
    if (String(url).includes('/comments/on-page')) return json(onPage())
    throw new Error(`unexpected ${url}`)
  }) as unknown as typeof fetch)
})

afterEach(() => {
  handle?.destroy()
  handle = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('layering (item 14)', () => {
  it('puts the site host after the overlay host on <html>, so the bar draws over the boxes', async () => {
    await ready()
    const children = Array.from(document.documentElement.children)
    const site = children.findIndex((node) => node.localName === SITE_HOST_TAG)
    const overlay = children.findIndex((node) => node.localName === OVERLAY_HOST_TAG)
    expect(overlay).toBeGreaterThanOrEqual(0)
    expect(site).toBeGreaterThan(overlay)
  })
})

describe('links and forms (item 18)', () => {
  /** Comentar on the title opens the composer, which turns the overlay off. */
  async function composerOpen() {
    await ready()
    click(tool('comment'))
    click($('h1'))
    await tick()
    expect(root().querySelector('textarea.composer')).not.toBeNull()
  }

  it('Editar: a page link does not navigate', async () => {
    await ready()
    click(tool('edit'))
    expect(tool('edit').getAttribute('aria-pressed')).toBe('true')
    expect(click($('#out')).defaultPrevented).toBe(true)
  })

  it('Editar: a page form is not submitted', async () => {
    await ready()
    click(tool('edit'))
    expect(submit($('#form') as HTMLFormElement).defaultPrevented).toBe(true)
  })

  it('Comentar with the composer open (the overlay off): a page link does not navigate', async () => {
    await composerOpen()
    expect(click($('#out')).defaultPrevented).toBe(true)
  })

  it('Comentar with the composer open (the overlay off): a page form is not submitted', async () => {
    await composerOpen()
    expect(submit($('#form') as HTMLFormElement).defaultPrevented).toBe(true)
  })

  it('Navegar: links and forms work', async () => {
    await ready()
    expect(tool('navigate').getAttribute('aria-pressed')).toBe('true')
    expect(click($('#out')).defaultPrevented).toBe(false)
    expect(submit($('#form') as HTMLFormElement).defaultPrevented).toBe(false)
  })

  it('the bar hidden (the pill), even with Comentar picked: links and forms work', async () => {
    await ready()
    click(tool('comment'))
    click(action('hide'))
    expect(action('show')).not.toBeNull()
    expect(click($('#out')).defaultPrevented).toBe(false)
    expect(submit($('#form') as HTMLFormElement).defaultPrevented).toBe(false)
  })
})

describe('the «no fields» empty state (item 13)', () => {
  it('Editar on an untagged page with no draft route says there is nothing to edit', async () => {
    document.body.innerHTML = '<main><h1>Sin etiquetas</h1></main>'
    await ready()
    click(tool('edit'))
    await tick()
    await tick()
    const toast = root().querySelector('.toast')
    expect(toast?.querySelector('.title')?.textContent).toBe('No hay campos para editar aquí')
    // It never took the tab anywhere: still Navegar.
    expect(tool('navigate').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the hide button (item 36)', () => {
  it('shows the eye-off icon, not the chevron, labelled «Ocultar barra»', async () => {
    await ready()
    const hide = action('hide')
    expect(hide.getAttribute('aria-label')).toBe('Ocultar barra')
    // Through the parser, as the icon itself was: `<path/>` reads back as `<path></path>`.
    const markup = (svg: string) => {
      const box = document.createElement('span')
      box.innerHTML = svg
      return box.innerHTML
    }
    const svg = hide.querySelector('.icon')!.innerHTML
    expect(svg).toBe(markup(ICONS.eyeOff))
    expect(svg).not.toBe(markup(ICONS.chevron))
  })
})

describe('«en …» on another record, hovered in Editar (item 37)', () => {
  async function hoverChip(selector: string) {
    await ready()
    click(tool('edit'))
    $(selector).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await tick(40)
    return overlayRoot().querySelector('.chip') as HTMLElement | null
  }

  it('a field of a site-wide record names its record, muted', async () => {
    const chip = await hoverChip('[data-zap="doc:configuracion#phone"]')
    expect(chip).not.toBeNull()
    expect(chip!.firstChild?.textContent).toBe('Teléfono')
    expect(chip!.querySelector('span.of')?.textContent).toBe('en Configuración')
  })

  it("a field of the page's own record has no suffix", async () => {
    const chip = await hoverChip('h1')
    expect(chip!.textContent).toBe('Título')
    expect(chip!.querySelector('span.of')).toBeNull()
  })
})

describe('reveal from the list', () => {
  it('scrolls the window to the thread, never with scrollIntoView', async () => {
    const intoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: intoView,
    })
    try {
      const scrollTo = vi.fn()
      vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo as unknown as typeof window.scrollTo)
      await ready()
      // The title sits far below the fold.
      vi.spyOn($('h1'), 'getBoundingClientRect').mockReturnValue({
        top: 2000,
        bottom: 2040,
        height: 40,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 2000,
        toJSON: () => ({}),
      } as DOMRect)
      click(action('open-list'))
      click(root().querySelector('[data-comment="r1"]')!)
      expect(intoView).not.toHaveBeenCalled()
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})
