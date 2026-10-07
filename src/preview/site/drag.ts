import { el, icon, TOKENS as T } from './ui'

/**
 * Moving the live site's toolbar (the `suggest` chunk's «Navegar», «Editar»,
 * «Comentar» pill) by a grip at its far left.
 *
 * - **Where it sits.** Nothing stored: the default bottom centre of the
 *   `.bottom` stack, untouched (the zone sites leave free for it, signin.ts).
 *   Once moved: the bar's top left, clamped to the viewport with a 16px
 *   gutter on every layout, resize and orientation change.
 * - **What rides with it.** The cards stacked with the bar (the open
 *   comments, the selection tray, the save status) open on the side with
 *   more room, above or below, centred on the bar and kept inside the
 *   viewport.
 * - **Remembered** per site origin in the page's `localStorage`, with
 *   whether the bar is hidden (`{ x, y, hidden }`, every part optional);
 *   every access may throw (private mode, blocked storage) and is caught. A
 *   double click (or double tap) on the grip puts the bar back and forgets
 *   the place.
 * - **Hidden** (SitioBarraEstados «Barra oculta»): the pill takes the bar's
 *   place, the same stored point or the default bottom centre, under the same
 *   clamp and resize rules. The pill itself is the grip (`grab`): a press
 *   that moves 3px or more drags it and is not a click; the place it lands
 *   is the bar's.
 * - **The account menu** rides in the stack too, right aligned under the
 *   account chip, above the bar or below it as the cards are.
 * - **Pointer and keys.** Pointer events with capture and `touch-action:
 *   none`; the arrow keys move it 16px (64px with Shift). Nothing the grip
 *   receives reaches the site: its pointer, mouse, touch and click events
 *   stop at the grip.
 */

export const BAR_STORAGE_KEY = 'eelzap:bar'

const GUTTER = 16
const STEP = 16
const BIG_STEP = 64
const GAP = 10
/** A press that moves less than this is a click, not a drag. */
const SLOP = 3
const DOUBLE_MS = 400

interface Point {
  x: number
  y: number
}

export interface BarDrag {
  /** The grip, one node for the bar's whole life: each render moves it into the new toolbar. */
  handle: HTMLButtonElement
  /** Whether the bar shows as the pill, remembered next to the place. */
  hidden(): boolean
  setHidden(value: boolean): void
  /** Make `node` (the pill) drag the stack too; its click after a drag is swallowed. */
  grab(node: HTMLElement): HTMLElement
  /** Lay out the stack again; call after every render of it. */
  place(): void
  destroy(): void
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

function storage(win: Window): Storage | null {
  try {
    return win.localStorage
  } catch {
    return null
  }
}

function read(win: Window): { pos: Point | null; hidden: boolean } {
  try {
    const value = JSON.parse(storage(win)?.getItem(BAR_STORAGE_KEY) ?? 'null') as
      | (Partial<Point> & { hidden?: unknown })
      | null
    return {
      pos:
        value && Number.isFinite(value.x) && Number.isFinite(value.y)
          ? { x: value.x!, y: value.y! }
          : null,
      hidden: value?.hidden === true,
    }
  } catch {
    return { pos: null, hidden: false }
  }
}

function write(win: Window, point: Point | null, hidden: boolean): void {
  try {
    const store = storage(win)
    if (point || hidden)
      store?.setItem(BAR_STORAGE_KEY, JSON.stringify({ ...point, hidden: hidden || undefined }))
    else store?.removeItem(BAR_STORAGE_KEY)
  } catch {
    // Storage full or blocked: the bar still moves, it just is not remembered.
  }
}

export function barDrag(
  win: Window,
  doc: Document,
  stack: HTMLElement,
  label: string,
  tip: string,
): BarDrag {
  const saved = read(win)
  let pos = saved.pos
  let hidden = saved.hidden
  let drag: {
    id: number
    px: number
    py: number
    from: Point
    moved: boolean
    node: HTMLElement
  } | null = null
  /** The press that just ended was a drag: its click is not one. */
  let dragged = false
  let lastTap = 0

  const viewport = (): [number, number] => {
    const root = doc.documentElement
    return [root.clientWidth || win.innerWidth, root.clientHeight || win.innerHeight]
  }
  const bar = () => stack.querySelector<HTMLElement>('.toolbar, .pill')
  const rectOf = (node: HTMLElement): Point => {
    const rect = node.getBoundingClientRect()
    return { x: rect.left, y: rect.top }
  }

  function place(): void {
    const toolbar = bar()
    const cards = Array.from(stack.children) as HTMLElement[]
    const [vw, vh] = viewport()
    if (!pos || !toolbar) {
      stack.removeAttribute('style')
      stack.removeAttribute('data-below')
      for (const card of cards) {
        card.style.marginLeft = ''
        card.style.maxHeight = ''
      }
      placeMenu(toolbar, vw)
      return
    }
    const w = toolbar.offsetWidth
    const h = toolbar.offsetHeight
    const x = clamp(pos.x, GUTTER, vw - w - GUTTER)
    const y = clamp(pos.y, GUTTER, vh - h - GUTTER)
    // The cards open on the side with more room.
    const below = vh - y - h > y
    const room = (below ? vh - y - h : y) - GAP - GUTTER
    Object.assign(stack.style, {
      padding: '0',
      alignItems: 'flex-start',
      flexDirection: below ? 'column-reverse' : 'column',
      top: below ? `${y}px` : 'auto',
      bottom: below ? 'auto' : `${vh - y - h}px`,
    })
    stack.toggleAttribute('data-below', below)
    for (const card of cards) {
      if (card.classList.contains('toast') || card.classList.contains('menu')) continue
      if (card.classList.contains('list')) card.style.maxHeight = `min(50vh, ${room}px)`
      const cw = card.offsetWidth
      card.style.marginLeft = `${card === toolbar ? x : clamp(x + (w - cw) / 2, GUTTER / 2, vw - cw - GUTTER / 2)}px`
    }
    placeMenu(toolbar, vw)
  }

  /** The account menu's right edge under the account chip (35px in from the bar's right edge). */
  function placeMenu(toolbar: HTMLElement | null, vw: number): void {
    const menu = stack.querySelector<HTMLElement>('.menu')
    if (!menu || !toolbar) return
    const left =
      stack.getBoundingClientRect().left +
      (parseFloat(win.getComputedStyle(stack).paddingLeft) || 0)
    const mw = menu.offsetWidth
    menu.style.alignSelf = 'flex-start'
    menu.style.marginLeft = `${clamp(toolbar.getBoundingClientRect().right - 35 - mw, GUTTER / 2, vw - mw - GUTTER / 2) - left}px`
  }

  /** Move to `point`, clamped, and remember where the bar really landed. */
  function moveTo(point: Point, save: boolean): void {
    pos = point
    place()
    const toolbar = bar()
    if (toolbar) pos = rectOf(toolbar)
    if (save) write(win, pos, hidden)
  }

  function reset(): void {
    pos = null
    write(win, null, hidden)
    place()
  }

  const onMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    const dx = event.clientX - drag.px
    const dy = event.clientY - drag.py
    if (!drag.moved && Math.hypot(dx, dy) < SLOP) return
    drag.moved = true
    event.preventDefault()
    pos = { x: drag.from.x + dx, y: drag.from.y + dy }
    place()
  }
  const onUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    const { moved, node } = drag
    drag = null
    node.removeAttribute('data-dragging')
    if (moved && pos) {
      moveTo(pos, true)
      lastTap = 0
      // The click that follows this pointerup comes in the same task.
      dragged = true
      win.setTimeout(() => (dragged = false))
    } else if (node === handle && event.type === 'pointerup') {
      // Two presses in a row without moving: back to the default place.
      const now = Date.now()
      if (now - lastTap < DOUBLE_MS) {
        lastTap = 0
        reset()
      } else lastTap = now
    }
  }

  const stop = (event: Event) => event.stopPropagation()
  function begin(e: PointerEvent, node: HTMLElement): void {
    const toolbar = bar()
    if (e.button !== 0 || !toolbar) return
    drag = {
      id: e.pointerId,
      px: e.clientX,
      py: e.clientY,
      from: rectOf(toolbar),
      moved: false,
      node,
    }
    node.setAttribute('data-dragging', '')
    try {
      node.setPointerCapture(e.pointerId)
    } catch {
      // An inactive pointer: the window listeners still follow it.
    }
  }
  const handle = el(doc, 'button', {
    class: 'grip',
    attrs: { type: 'button', 'aria-label': label, title: tip },
    on: {
      pointerdown: (event) => {
        event.stopPropagation()
        begin(event as PointerEvent, handle)
      },
      keydown: (event) => {
        const e = event as KeyboardEvent
        const step = e.shiftKey ? BIG_STEP : STEP
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }
        const move = delta[e.key]
        const toolbar = bar()
        if (!move || !toolbar) return
        e.preventDefault()
        e.stopPropagation()
        const from = rectOf(toolbar)
        moveTo({ x: from.x + move[0], y: from.y + move[1] }, true)
      },
    },
  })
  for (const type of [
    'pointerup',
    'dblclick',
    'mousedown',
    'mouseup',
    'click',
    'touchstart',
    'touchend',
  ]) {
    handle.addEventListener(type, stop)
  }
  handle.append(icon(doc, 'grip'))

  // Capture on the window: the grip stops its own events from bubbling, and a
  // render mid-drag may take it out of the page.
  const onResize = () => place()
  win.addEventListener('pointermove', onMove, true)
  win.addEventListener('pointerup', onUp, true)
  win.addEventListener('pointercancel', onUp, true)
  win.addEventListener('resize', onResize)
  win.addEventListener('orientationchange', onResize)

  return {
    handle,
    grab(node) {
      node.addEventListener('pointerdown', (event) => begin(event as PointerEvent, node))
      node.addEventListener(
        'click',
        (event) => {
          if (dragged) event.stopImmediatePropagation()
        },
        true,
      )
      return node
    },
    place,
    hidden: () => hidden,
    setHidden(value) {
      hidden = value
      write(win, pos, hidden)
    },
    destroy() {
      win.removeEventListener('pointermove', onMove, true)
      win.removeEventListener('pointerup', onUp, true)
      win.removeEventListener('pointercancel', onUp, true)
      win.removeEventListener('resize', onResize)
      win.removeEventListener('orientationchange', onResize)
    },
  }
}

/** The grip's own styles; the bar's shared hover treatment lives with the bar (suggest.ts). */
export const DRAG_CSS = `
.grip { width: 20px; height: 30px; justify-content: center; border-radius: 7px; color: ${T.muted};
  cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.grip[data-dragging], .pill[data-dragging] { cursor: grabbing; }
.pill { touch-action: none; user-select: none; -webkit-user-select: none; }
.bottom[data-below] .seg[data-tip]:hover::after { bottom: auto; top: 34px; }
`
