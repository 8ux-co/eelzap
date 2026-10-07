import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OnPage } from './api'
import type { SiteContext } from './config'
import { BAR_STORAGE_KEY, barDrag, DRAG_CSS, type BarDrag } from './drag'
import { captureShadowRoots, tick } from './spec-helpers'
import { start } from './suggest'
import { writeToken } from './token'

/**
 * Moving the live site's bar (`drag.ts`) and the bar's own CSS (suggest.ts,
 * ui.ts): the grip and the pill drag past a 3px slop, the click after a drag
 * is swallowed, keys move 16px (64px with Shift), the place is clamped to the
 * viewport with a 16px gutter and remembered with `hidden`; the cards and the
 * account menu follow; hover, focus ring, reduced motion and the tooltip's
 * flip under the bar.
 *
 * jsdom has no layout: the viewport, the bar's size and its rect are stubbed,
 * the rect following the place `drag.ts` writes into the styles.
 */

const VW = 1000
const VH = 800
const BAR_W = 300
const BAR_H = 40
/** Where the bar sits before it is ever moved (the CSS's bottom centre). */
const HOME = { x: 350, y: 738 }

let viewport = { w: VW, h: VH }
let stack: HTMLElement
let drags: BarDrag[] = []

function size(node: HTMLElement, w: number, h: number) {
  Object.defineProperty(node, 'offsetWidth', { configurable: true, get: () => w })
  Object.defineProperty(node, 'offsetHeight', { configurable: true, get: () => h })
}

/** The bar's rect, read back from the place drag.ts gave it. */
function followPlace(bar: HTMLElement) {
  bar.getBoundingClientRect = () => {
    const left = bar.style.marginLeft ? parseFloat(bar.style.marginLeft) : HOME.x
    const top =
      stack.style.top && stack.style.top !== 'auto'
        ? parseFloat(stack.style.top)
        : stack.style.bottom && stack.style.bottom !== 'auto'
          ? viewport.h - parseFloat(stack.style.bottom) - BAR_H
          : HOME.y
    return {
      left,
      top,
      right: left + BAR_W,
      bottom: top + BAR_H,
      width: BAR_W,
      height: BAR_H,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect
  }
}

function mount(kind: 'toolbar' | 'pill' = 'toolbar', cards: HTMLElement[] = []) {
  stack = document.createElement('div')
  stack.className = 'bottom'
  const bar = document.createElement(kind === 'pill' ? 'button' : 'div')
  bar.className = `card ${kind}`
  size(bar, BAR_W, BAR_H)
  followPlace(bar)
  stack.append(...cards, bar)
  document.body.append(stack)
  const drag = barDrag(window, document, stack, 'Mover la barra', 'Arrastra para mover la barra')
  drags.push(drag)
  if (kind === 'toolbar') bar.prepend(drag.handle)
  drag.place()
  return { drag, bar }
}

const pointer = (type: string, target: EventTarget, x: number, y: number, id = 1) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: id,
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
      cancelable: true,
      // As a real pointer event: it leaves the closed shadow root for the window's listeners.
      composed: true,
    }),
  )

/** Press at (x, y), move by (dx, dy), release: one gesture. */
function press(node: HTMLElement, dx: number, dy: number, at = { x: 400, y: 750 }) {
  pointer('pointerdown', node, at.x, at.y)
  if (dx || dy) pointer('pointermove', node, at.x + dx, at.y + dy)
  pointer('pointerup', node, at.x + dx, at.y + dy)
}

const stored = () => {
  const raw = localStorage.getItem(BAR_STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}
const barLeft = (bar: HTMLElement) => parseFloat(bar.style.marginLeft)
const barTop = (bar: HTMLElement) => bar.getBoundingClientRect().top

beforeEach(() => {
  localStorage.clear()
  viewport = { w: VW, h: VH }
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    get: () => viewport.w,
  })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => viewport.h,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  for (const drag of drags) drag.destroy()
  drags = []
  document.body.innerHTML = ''
  delete (document.documentElement as { clientWidth?: number }).clientWidth
  delete (document.documentElement as { clientHeight?: number }).clientHeight
  delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture
  vi.restoreAllMocks()
})

describe('the pill drags the stack (item 17)', () => {
  it('a press that moves 3px or more drags, and the click that follows is swallowed', () => {
    const { drag, bar } = mount('pill')
    const clicked = vi.fn()
    drag.grab(bar)
    bar.addEventListener('click', clicked)
    press(bar, 40, -100)
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicked).not.toHaveBeenCalled()
    expect(barLeft(bar)).toBe(HOME.x + 40)
    expect(barTop(bar)).toBe(HOME.y - 100)
  })

  it('the click after a drag is swallowed only in that task; the next click goes through', async () => {
    const { drag, bar } = mount('pill')
    const clicked = vi.fn()
    drag.grab(bar)
    bar.addEventListener('click', clicked)
    press(bar, 40, 0)
    await tick()
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('a press that moves under 3px is a plain click and moves nothing', () => {
    const { drag, bar } = mount('pill')
    const clicked = vi.fn()
    drag.grab(bar)
    bar.addEventListener('click', clicked)
    press(bar, 2, 0)
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(stored()).toBeNull()
    expect(stack.getAttribute('style')).toBeNull()
  })

  it('stores where it lands, keeping hidden', () => {
    const { drag, bar } = mount('pill')
    drag.grab(bar)
    drag.setHidden(true)
    expect(stored()).toEqual({ hidden: true })
    press(bar, -50, -200)
    expect(stored()).toEqual({ x: HOME.x - 50, y: HOME.y - 200, hidden: true })
    expect(drag.hidden()).toBe(true)
  })
})

describe('the grip', () => {
  it('moves the bar past 3px, with the same slop', () => {
    const { drag, bar } = mount()
    press(drag.handle, 2, 0)
    expect(stored()).toBeNull()
    press(drag.handle, 3, 0)
    expect(stored()).toEqual({ x: HOME.x + 3, y: HOME.y })
    expect(barLeft(bar)).toBe(HOME.x + 3)
  })

  it('a double tap puts the bar back and forgets the place; one tap does not', () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 100, y: 100 }))
    const { drag, bar } = mount()
    expect(barLeft(bar)).toBe(100)
    press(drag.handle, 0, 0)
    expect(stored()).toEqual({ x: 100, y: 100 })
    press(drag.handle, 0, 0)
    expect(stored()).toBeNull()
    expect(stack.getAttribute('style')).toBeNull()
    expect(bar.style.marginLeft).toBe('')
  })

  it('a double tap keeps the bar hidden flag', () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 100, y: 100, hidden: true }))
    const { drag } = mount()
    press(drag.handle, 0, 0)
    press(drag.handle, 0, 0)
    expect(stored()).toEqual({ hidden: true })
  })

  it("the grip's own events stop at the grip", () => {
    const { drag } = mount()
    const seen = vi.fn()
    stack.addEventListener('click', seen)
    stack.addEventListener('pointerdown', seen)
    stack.addEventListener('mousedown', seen)
    drag.handle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    drag.handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    pointer('pointerdown', drag.handle, 0, 0)
    pointer('pointerup', drag.handle, 0, 0)
    expect(seen).not.toHaveBeenCalled()
  })
})

describe('keys', () => {
  const keydown = (node: HTMLElement, key: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
    node.dispatchEvent(event)
    return event
  }

  it('arrows move 16px and the place is stored', () => {
    const { drag, bar } = mount()
    expect(keydown(drag.handle, 'ArrowLeft').defaultPrevented).toBe(true)
    expect(barLeft(bar)).toBe(HOME.x - 16)
    keydown(drag.handle, 'ArrowUp')
    expect(barTop(bar)).toBe(HOME.y - 16)
    expect(stored()).toEqual({ x: HOME.x - 16, y: HOME.y - 16 })
  })

  it('Shift and an arrow move 64px', () => {
    const { drag, bar } = mount()
    keydown(drag.handle, 'ArrowRight', true)
    keydown(drag.handle, 'ArrowUp', true)
    expect(barLeft(bar)).toBe(HOME.x + 64)
    expect(barTop(bar)).toBe(HOME.y - 64)
    expect(stored()).toEqual({ x: HOME.x + 64, y: HOME.y - 64 })
  })

  it('other keys pass through', () => {
    const { drag } = mount()
    expect(keydown(drag.handle, 'Enter').defaultPrevented).toBe(false)
    expect(stored()).toBeNull()
  })
})

describe('the clamp', () => {
  it('keeps a stored place inside the viewport with a 16px gutter', () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: -500, y: 5000 }))
    const { bar } = mount()
    expect(barLeft(bar)).toBe(16)
    expect(barTop(bar)).toBe(VH - BAR_H - 16)
  })

  it('a drag past the edge lands on the gutter, and that is what is stored', () => {
    const { drag, bar } = mount()
    press(drag.handle, 5000, -5000)
    expect(barLeft(bar)).toBe(VW - BAR_W - 16)
    expect(barTop(bar)).toBe(16)
    expect(stored()).toEqual({ x: VW - BAR_W - 16, y: 16 })
  })

  it('clamps again on resize', () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 650, y: 700 }))
    const { bar } = mount()
    expect(barLeft(bar)).toBe(650)
    viewport = { w: 600, h: 500 }
    window.dispatchEvent(new Event('resize'))
    expect(barLeft(bar)).toBe(600 - BAR_W - 16)
    expect(barTop(bar)).toBe(500 - BAR_H - 16)
  })
})

describe('storage', () => {
  it('reads { x, y, hidden }', () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 120, y: 200, hidden: true }))
    const { drag, bar } = mount()
    expect(drag.hidden()).toBe(true)
    expect(barLeft(bar)).toBe(120)
    expect(barTop(bar)).toBe(200)
  })

  it('ignores a stored value that is not a point', () => {
    localStorage.setItem(BAR_STORAGE_KEY, '{"x":"a","y":null}')
    const { drag } = mount()
    expect(drag.hidden()).toBe(false)
    expect(stack.getAttribute('style')).toBeNull()
  })

  it('survives storage that throws, on read and on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { drag, bar } = mount()
    expect(drag.hidden()).toBe(false)
    expect(() => press(drag.handle, 30, 0)).not.toThrow()
    expect(barLeft(bar)).toBe(HOME.x + 30)
    expect(() => drag.setHidden(true)).not.toThrow()
  })

  it('removes the key when nothing is left to remember', () => {
    const { drag } = mount()
    drag.setHidden(true)
    expect(stored()).toEqual({ hidden: true })
    drag.setHidden(false)
    expect(localStorage.getItem(BAR_STORAGE_KEY)).toBeNull()
  })
})

describe('the cards and the account menu follow the bar', () => {
  function card(className: string, w: number) {
    const node = document.createElement('div')
    node.className = `card ${className}`
    size(node, w, 100)
    return node
  }

  it('open below when there is more room below, centred on the bar', () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 100, y: 50 }))
    const list = card('list', 420)
    mount('toolbar', [list])
    expect(stack.hasAttribute('data-below')).toBe(true)
    expect(stack.style.flexDirection).toBe('column-reverse')
    expect(stack.style.top).toBe('50px')
    // Centred on the bar, clamped to half the gutter.
    expect(list.style.marginLeft).toBe(`${100 + (BAR_W - 420) / 2}px`)
    expect(list.style.maxHeight).toBe(`min(50vh, ${VH - 50 - BAR_H - 10 - 16}px)`)
  })

  it('open above when there is more room above', () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 100, y: 600 }))
    const list = card('list', 420)
    mount('toolbar', [list])
    expect(stack.hasAttribute('data-below')).toBe(false)
    expect(stack.style.flexDirection).toBe('column')
    expect(stack.style.bottom).toBe(`${VH - 600 - BAR_H}px`)
    expect(list.style.maxHeight).toBe(`min(50vh, ${600 - 10 - 16}px)`)
  })

  it('the account menu is right aligned under the account chip', () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 400, y: 50 }))
    const menu = card('menu', 260)
    mount('toolbar', [menu])
    // The bar's right edge (400 + 300) less 35px, less the menu's width.
    expect(menu.style.marginLeft).toBe(`${400 + BAR_W - 35 - 260}px`)
    expect(menu.style.alignSelf).toBe('flex-start')
  })

  it('the default place also right aligns the menu', () => {
    const menu = card('menu', 260)
    mount('toolbar', [menu])
    expect(menu.style.marginLeft).toBe(`${HOME.x + BAR_W - 35 - 260}px`)
  })
})

// ── The bar's CSS and its tooltip, in the mounted chunk ───────────────────

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ZAP = 'https://zap.eel.software'

describe('the bar, mounted', () => {
  let shadows: ReturnType<typeof captureShadowRoots>
  let handle: { destroy(): void } | null = null

  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState(null, '', '/blog/hola')
    document.body.innerHTML = `<article data-zap-entry="blog/hola">
      <h1 data-zap="blog/hola#title">Cosecha</h1></article>`
    writeToken(window, {
      token: 'eel_at_ABCDEFGHIJKL_0123456789',
      exp: Date.now() + 3_600_000,
      site: SITE,
    })
    shadows = captureShadowRoots()
    const page: OnPage = {
      viewer: { name: 'Camila Restrepo' },
      liveEditing: true,
      fields: { 'blog/hola': { title: { type: 'TEXT', label: 'Título' } } },
      comments: [],
      truncated: false,
    }
    vi.spyOn(window, 'fetch').mockImplementation(
      (async () => new Response(JSON.stringify(page), { status: 200 })) as unknown as typeof fetch,
    )
  })

  afterEach(() => {
    handle?.destroy()
    handle = null
  })

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
      open: vi.fn(async () => {}),
      close: vi.fn(),
    }
    handle = start(ctx)
    await tick()
    await tick()
  }
  const root = () => shadows.current()
  const css = () => root().querySelector('style')!.textContent ?? ''
  const action = (name: string) => root().querySelector(`[data-action="${name}"]`) as HTMLElement

  it('ships the grip CSS (DRAG_CSS) in the bar host', async () => {
    await ready()
    expect(css()).toContain(DRAG_CSS)
    expect(DRAG_CSS).toContain('touch-action: none')
  })

  it('hover: the tools on the track, the bar buttons and the pill', async () => {
    await ready()
    const sheet = css()
    expect(sheet).toContain(
      '.seg:not([aria-pressed="true"]):not([aria-disabled="true"]):hover { background: rgba(255,255,255,.6); color: #010313; }',
    )
    expect(sheet).toContain(
      '.tool:hover, .grip:hover, .account[aria-expanded="true"] { background: #F1F5F9; color: #010313; }',
    )
    expect(sheet).toContain('.pill:hover { background: #F8FAFC; }')
  })

  it('focus ring: the tools, the grip and the pill', async () => {
    await ready()
    const sheet = css()
    expect(sheet).toContain(
      '.seg:focus-visible, .tool:focus-visible, .grip:focus-visible { box-shadow: 0 0 0 3px rgba(144,161,185,0.5); }',
    )
    expect(sheet).toContain('.pill:focus-visible { box-shadow: 0 0 0 3px rgba(144,161,185,0.5),')
    expect(sheet).toContain(
      'button:focus-visible, textarea:focus-visible, input:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(144,161,185,0.5); }',
    )
  })

  it('reduced motion: no transitions on the bar, no entrance animation', async () => {
    await ready()
    expect(css()).toContain(
      '@media (prefers-reduced-motion: reduce) { .seg, .tool, .grip, .pill, .switch, .knob { transition: none; } [data-enter] { animation: none; } }',
    )
  })

  it('the disabled tool hint flips under the bar when the cards open below', async () => {
    await ready()
    expect(css()).toContain(
      '.bottom[data-below] .seg[data-tip]:hover::after { bottom: auto; top: 34px; }',
    )
  })

  function tipFor(target: HTMLElement, rect: Partial<DOMRect>) {
    target.getBoundingClientRect = () =>
      ({ left: 500, right: 530, width: 30, height: 30, top: 0, bottom: 0, ...rect }) as DOMRect
    target.dispatchEvent(new MouseEvent('mouseenter'))
    const tip = root().querySelector('.tip') as HTMLElement
    expect(tip.classList.contains('on')).toBe(true)
    return tip
  }

  it('the tooltip sits over the bar when the cards open above', async () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 100, y: 700 }))
    await ready()
    expect(root().querySelector('.bottom')!.hasAttribute('data-below')).toBe(false)
    const tip = tipFor(action('hide'), { top: 705, bottom: 735 })
    expect(tip.style.top).toBe(`${705 - 15}px`)
  })

  it('the tooltip flips under the bar when the cards open below', async () => {
    localStorage.setItem(BAR_STORAGE_KEY, JSON.stringify({ x: 100, y: 20 }))
    await ready()
    expect(root().querySelector('.bottom')!.hasAttribute('data-below')).toBe(true)
    const tip = tipFor(action('hide'), { top: 25, bottom: 55 })
    expect(tip.style.top).toBe(`${55 + 15}px`)
  })

  it('the pill, dragged, does not bring the bar back; pressed in place, it does', async () => {
    await ready()
    action('hide').click()
    const pill = action('show')
    expect(pill).not.toBeNull()
    pointer('pointerdown', pill, 400, 750)
    pointer('pointermove', pill, 450, 600)
    pointer('pointerup', pill, 450, 600)
    pill.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    expect(action('show')).not.toBeNull()
    expect(action('hide')).toBeNull()
    expect(stored()).toMatchObject({ hidden: true })
    await tick()
    action('show').click()
    expect(action('hide')).not.toBeNull()
  })
})
