import {
  MAX_ANCHORS,
  MAX_PINS,
  type OverlayMode,
  type OverlayTheme,
  type SpotAnchor,
  type SpotPoint,
} from './protocol'
import type { TagIndex, TaggedElement } from './tags'

/**
 * The in-page overlay (§2.4 "Finding the element for a field", §3.3
 * "Selecting in the preview", ui-patterns/preview-panel.md rule 5).
 *
 * - Everything is drawn in a CLOSED Shadow DOM on a custom element appended
 *   to `<html>`, so the site's CSS cannot restyle it and it cannot restyle
 *   the site, and site scripts cannot reach into it through `shadowRoot`.
 * - Outlines are 2px gold with a field chip at the element's top right, both
 *   DIVIDED BY THE ZOOM so they stay 2px and 12px on screen when the panel
 *   scales the page down (Designer's boards PreviewEtiquetada /
 *   SeleccionarElementos: outline #CF8700, chip #9A6200 with white text,
 *   selected elements tinted rgba(207,135,0,0.10) and the chip gains a check).
 * - Modes: `inspect` (hover outlines tagged elements; click focuses the field
 *   in the form), `select` (hover outlines any element; click selects, Shift
 *   or Cmd/Ctrl click adds, Esc clears; with `spotOnLarge`, a plain click on
 *   the page itself or on an element covering half the viewport or more
 *   places a spot instead, as the site's Comentar does: one tool comments on
 *   elements and on points), `off` (nothing drawn, nothing
 *   intercepted), `spot` (comments: a transparent capture layer in the shadow
 *   root covers the page, so a click never reaches the site; the click becomes
 *   a point of the whole document and a pending pin is drawn there; Esc clears
 *   it; no hover outlines).
 * - Numbered comment pins (`setPins`) are drawn in every mode but `off` (in
 *   `off` too with `pinsWhenOff`, the live site's «Navegar»), and are the only
 *   things here that take the pointer besides the capture layer.
 *   A click on one is consumed and reported (`onPin`), never also a spot.
 * - Boxes are `position: fixed` from `getBoundingClientRect()` and redrawn on
 *   scroll and resize in one animation frame, so nothing in the site's layout
 *   moves.
 */

export const OVERLAY_HOST_TAG = 'eel-zap-overlay'

const DEFAULT_THEME: Required<OverlayTheme> = {
  outline: '#CF8700',
  chip: '#9A6200',
  chipText: '#FFFFFF',
}

const SELECTED_TINT = 'rgba(207,135,0,0.10)'

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

export interface OverlayCallbacks {
  /** Inspect mode: a tagged element was clicked. */
  onInspect?(tagged: TaggedElement): void
  /** Select mode: the selection changed (≤ 20 elements). */
  onSelect?(elements: Element[]): void
  /** Spot mode: the page was clicked at this point of the document. */
  onSpot?(anchor: SpotAnchor): void
  /** A pin was clicked. */
  onPin?(pin: { id: string }): void
}

/** A pin to draw: at a point of the document, or at an element's top-left corner. */
export interface OverlayPin {
  id: string
  n: number
  spot?: SpotPoint
  element?: Element
}

export interface OverlayOptions extends OverlayCallbacks {
  doc: Document
  win: Window
  index: TagIndex
  /** Events on these targets are not the overlay's (the suggestion UI's own host). */
  ignore?(target: EventTarget): boolean
  /** Select mode: every click adds or removes, Shift or not (the site toolbar's Seleccionar). */
  additive?(): boolean
  /** Draw the pins in `off` mode too, intercepting nothing else (the live site's «Navegar»). */
  pinsWhenOff?: boolean
  /**
   * Select mode: a plain click on `<html>`/`<body>` or on an element taking
   * at least half the viewport is a spot (`onSpot`), not a selection. Zap's
   * preview has ONE comment toggle (board Main, «Comentar sobre la página»)
   * and this is how it reaches both anchors.
   */
  spotOnLarge?: boolean
}

type BoxKind = 'hover' | 'focus' | 'selected' | 'highlight'

interface Box {
  element: Element
  kind: BoxKind
  label: string | null
  /** A field of another record: «en Configuración», drawn muted after the label. */
  suffix?: string
}

export class Overlay {
  private host: HTMLElement | null = null
  private layer: HTMLElement | null = null
  private mode: OverlayMode = 'off'
  private zoom = 1
  private theme: Required<OverlayTheme> = { ...DEFAULT_THEME }
  private labels: Record<string, string> = {}
  private foreign: Record<string, [string, string]> = {}
  private hover: Element | null = null
  private focused: Element[] = []
  private highlighted: Element[] = []
  private selected: Element[] = []
  private pins: OverlayPin[] = []
  private pending: SpotPoint | null = null
  private capture: HTMLElement | null = null
  private frame: number | null = null
  private readonly listeners: Array<[EventTarget, string, EventListener, boolean]> = []

  constructor(private readonly options: OverlayOptions) {}

  mount(): void {
    if (this.host) return
    const { doc } = this.options
    const host = doc.createElement(OVERLAY_HOST_TAG)
    // Inline !important so a site rule like `* { display: none }` cannot hide it.
    const hostStyle: Record<string, string> = {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      'pointer-events': 'none',
      'z-index': '2147483647',
      display: 'block',
    }
    for (const [name, value] of Object.entries(hostStyle)) {
      host.style.setProperty(name, value, 'important')
    }
    const shadow = host.attachShadow({ mode: 'closed' })
    const style = doc.createElement('style')
    style.textContent = STYLES
    const layer = doc.createElement('div')
    layer.className = 'layer'
    // Spot mode's capture layer, under the boxes and pins; shown in spot mode only.
    const capture = doc.createElement('div')
    capture.className = 'capture'
    capture.onclick = (event) => {
      this.consume(event)
      this.spotAt(event)
    }
    shadow.append(style, capture, layer)
    this.capture = capture
    doc.documentElement.appendChild(host)
    this.host = host
    this.layer = layer
    this.install()
    this.render()
  }

  /**
   * Register the event listeners. Called by `mount()`, and EARLIER by the
   * runtime — at script start, before any site script has run — so our
   * capture listeners on `window` are first in line, ahead of anything the
   * site registers.
   */
  install(): void {
    if (this.listeners.length > 0) return
    const { win } = this.options
    this.listen(win, 'mouseover', (event) => this.onPointer(event as MouseEvent))
    // Leaving the document (relatedTarget null) clears the hover outline.
    this.listen(win, 'mouseout', (event) => {
      if (!(event as MouseEvent).relatedTarget) this.setHover(null)
    })
    this.listen(win, 'click', (event) => this.onClick(event as MouseEvent))
    // While the overlay is on, the page never navigates away (Zap's preview
    // frame; the live site's Editar and Comentar): no form is submitted.
    this.listen(win, 'submit', (event) => this.mode !== 'off' && this.consume(event))
    this.listen(win, 'keydown', (event) => this.onKey(event as KeyboardEvent))
    this.listen(win, 'scroll', () => this.schedule())
    this.listen(win, 'resize', () => this.schedule())
  }

  destroy(): void {
    for (const [target, type, listener, capture] of this.listeners) {
      target.removeEventListener(type, listener, capture)
    }
    this.listeners.length = 0
    this.host?.remove()
    this.host = null
    this.layer = null
    this.capture = null
  }

  /** The host element, so the tag observer can ignore our own mutations. */
  get hostElement(): Element | null {
    return this.host
  }

  getMode(): OverlayMode {
    return this.mode
  }

  setMode(mode: OverlayMode): void {
    if (mode === this.mode) return
    const hadSelection = this.selected.length > 0
    this.mode = mode
    this.hover = null
    this.pending = null
    if (mode !== 'select' && hadSelection) {
      this.selected = []
      this.options.onSelect?.([])
    }
    if (mode === 'off') {
      this.focused = []
      this.highlighted = []
    }
    this.schedule()
  }

  setZoom(zoom: number): void {
    if (!(zoom > 0)) return
    this.zoom = zoom
    this.schedule()
  }

  setTheme(theme: OverlayTheme | undefined): void {
    this.theme = { ...DEFAULT_THEME, ...(theme ?? {}) }
    this.schedule()
  }

  /** Labels by field key; `foreign`, by full tag, the fields of other records (`HelloPayload.foreign`). */
  setLabels(labels: Record<string, string>, foreign: Record<string, [string, string]> = {}): void {
    this.labels = { ...labels }
    this.foreign = { ...foreign }
    this.schedule()
  }

  /** Outline every element of a field and scroll the first into view. */
  focusField(elements: Element[]): number {
    this.focused = elements.slice()
    const first = elements[0]
    if (first) reveal(this.options.win, first)
    this.schedule()
    return elements.length
  }

  /** Outline change-request anchors and scroll to the first. */
  highlight(elements: Element[]): void {
    this.highlighted = elements.slice(0, MAX_ANCHORS)
    const first = this.highlighted[0]
    if (first) reveal(this.options.win, first)
    this.schedule()
  }

  /** Draw these pins (≤ 50); drops the pending spot pin. */
  setPins(pins: OverlayPin[]): void {
    this.pins = pins.slice(0, MAX_PINS)
    this.clearPending()
  }

  /** Drop the pending spot pin. */
  clearPending(): void {
    this.pending = null
    this.schedule()
  }

  clearSelection(): void {
    if (this.selected.length === 0) return
    this.selected = []
    this.options.onSelect?.([])
    this.schedule()
  }

  get selection(): readonly Element[] {
    return this.selected
  }

  /** For specs: what the closed shadow root currently draws. */
  inspect(): {
    boxes: Array<{ kind: BoxKind; label: string | null }>
    pins: HTMLElement[]
    capture: HTMLElement | null
    zoom: number
  } {
    const nodes = Array.from(this.layer?.children ?? []) as HTMLElement[]
    const boxes = nodes
      .filter((node) => node.className === 'box')
      .map((node) => ({
        kind: node.dataset.kind as BoxKind,
        label: node.querySelector('.chip')?.textContent ?? null,
      }))
    const capture = this.capture?.style.display === 'block' ? this.capture : null
    return { boxes, pins: nodes.filter((n) => n.className === 'pin'), capture, zoom: this.zoom }
  }

  /** For specs: the style of the n-th box. */
  boxStyle(n: number): CSSStyleDeclaration | null {
    const node = this.layer?.children[n] as HTMLElement | undefined
    return node?.style ?? null
  }

  // ── Events ────────────────────────────────────────────────────────────────

  private listen(target: EventTarget, type: string, listener: EventListener): void {
    // Capture on window: we see the event before any site listener, so a
    // site's own click handler (a router, a lightbox) never runs for a click
    // that the overlay consumed.
    target.addEventListener(type, listener, true)
    this.listeners.push([target, type, listener, true])
  }

  private isOwn(node: EventTarget | null): boolean {
    return (!!this.host && node === this.host) || (!!node && !!this.options.ignore?.(node))
  }

  private targetFor(event: Event): Element | null {
    const target = event.target as Element | null
    if (!target || this.isOwn(target) || typeof target.closest !== 'function') return null
    if (this.mode === 'inspect') return this.options.index.closest(target)?.element ?? null
    if (this.mode === 'select') {
      const tagged = this.options.index.closest(target)
      const element = tagged?.element ?? target
      const name = element.localName
      return name === 'html' || name === 'body' ? null : element
    }
    return null
  }

  private onPointer(event: MouseEvent): void {
    if (this.mode === 'off') return
    this.setHover(this.targetFor(event))
  }

  private setHover(element: Element | null): void {
    if (element === this.hover) return
    this.hover = element
    this.schedule()
  }

  private onClick(event: MouseEvent): void {
    if (this.mode === 'off' || this.isOwn(event.target)) return
    // Nor does a link navigate; a tagged one still selects its field below.
    if ((event.target as Element).closest?.('a[href],area[href]')) this.consume(event)
    if (this.mode === 'spot') {
      // The capture layer normally takes the click; anything that still lands
      // on the site (a synthetic click, a gap) is consumed the same way.
      this.consume(event)
      return this.spotAt(event)
    }
    const element = this.targetFor(event)
    if (this.mode === 'inspect') {
      if (!element) return
      const tagged = this.options.index.get(element)
      if (!tagged) return
      event.preventDefault()
      event.stopImmediatePropagation()
      this.options.onInspect?.(tagged)
      return
    }
    // Select mode consumes every click, so nothing on the page reacts.
    this.consume(event)
    const additive = event.shiftKey || event.metaKey || event.ctrlKey || !!this.options.additive?.()
    if (this.options.spotOnLarge && !additive && (!element || this.isLarge(element))) {
      // A wrapper, not the thing the person pointed at: comment on the point.
      this.clearSelection()
      return this.spotAt(event)
    }
    if (!element) return
    if (this.pending) this.clearPending()
    let next: Element[]
    if (additive) {
      next = this.selected.includes(element)
        ? this.selected.filter((e) => e !== element)
        : this.selected.length < MAX_ANCHORS
          ? [...this.selected, element]
          : this.selected
    } else {
      next = [element]
    }
    if (next === this.selected) return
    this.selected = next
    this.options.onSelect?.(next.slice())
    this.schedule()
  }

  /** Most of the viewport: a wrapper, not the thing the person pointed at. */
  private isLarge(element: Element): boolean {
    const { win } = this.options
    const rect = element.getBoundingClientRect()
    const area = Math.max(1, win.innerWidth * win.innerHeight)
    return (rect.width * rect.height) / area >= LARGE_SHARE
  }

  private consume(event: Event): void {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  /** The click as a point of the whole document (§3.3 spot anchor). */
  private spotAt(event: MouseEvent): void {
    const { doc, win } = this.options
    const root = doc.documentElement
    const w = Math.max(root.scrollWidth, 1)
    const h = Math.max(root.scrollHeight, 1)
    const at = (v: number, size: number) => Math.min(1, Math.max(0, v / size))
    const spot = { x: at(event.clientX + win.scrollX, w), y: at(event.clientY + win.scrollY, h) }
    this.pending = spot
    this.schedule()
    this.options.onSpot?.({ spot, viewport: { w, h } })
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    if ((this.mode === 'spot' || this.mode === 'select') && this.pending) {
      this.consume(event)
      return this.clearPending()
    }
    if (this.mode !== 'select' || this.selected.length === 0) return
    this.consume(event)
    this.clearSelection()
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  private schedule(): void {
    if (!this.layer || this.frame !== null) return
    const win = this.options.win
    const raf =
      typeof win.requestAnimationFrame === 'function'
        ? (fn: () => void) => win.requestAnimationFrame(fn)
        : (fn: () => void) => win.setTimeout(fn, 16)
    this.frame = raf(() => {
      this.frame = null
      this.render()
    }) as number
  }

  /** Draw now (also used by specs, which have no animation frames). */
  render(): void {
    const layer = this.layer
    if (!layer) return
    const boxes: Box[] = []
    const seen = new Set<Element>()
    const add = (element: Element, kind: BoxKind) => {
      if (seen.has(element) || !element.isConnected) return
      seen.add(element)
      const tagged = this.options.index.get(element)
      const [label, suffix] = tagged ? this.labelFor(tagged) : [null]
      boxes.push({ element, kind, label, suffix })
    }
    if (this.mode !== 'off') {
      for (const element of this.selected) add(element, 'selected')
      for (const element of this.focused) add(element, 'focus')
      for (const element of this.highlighted) add(element, 'highlight')
      if (this.hover) add(this.hover, 'hover')
    }
    const nodes = boxes.map((box) => this.drawBox(box))
    if (this.capture) this.capture.style.display = this.mode === 'spot' ? 'block' : 'none'
    if (this.mode !== 'off' || this.options.pinsWhenOff) {
      const { doc, win } = this.options
      const root = doc.documentElement
      const toView = (p: SpotPoint): [number, number] => [
        p.x * root.scrollWidth - win.scrollX,
        p.y * root.scrollHeight - win.scrollY,
      ]
      for (const pin of this.pins) {
        const element = pin.element
        if (element) {
          if (!element.isConnected) continue
          const rect = element.getBoundingClientRect()
          nodes.push(this.drawPin([rect.left, rect.top], pin))
        } else if (pin.spot) nodes.push(this.drawPin(toView(pin.spot), pin))
      }
      if (this.pending && (this.mode === 'spot' || this.mode === 'select')) {
        nodes.push(this.drawPin(toView(this.pending)))
      }
    }
    layer.replaceChildren(...nodes)
    // Chips stay inside the viewport: measured once drawn, shifted in.
    const inset = EDGE_PX / this.zoom
    for (const chip of layer.querySelectorAll<HTMLElement>('.chip')) {
      const { left, right } = chip.getBoundingClientRect()
      const dx = Math.min(Math.max(0, inset - left), this.options.win.innerWidth - inset - right)
      chip.style.transform = `translateX(${dx}px)`
    }
  }

  /** A gold teardrop whose point (bottom-left) sits on `[x, y]`; without a pin, the pending one. */
  private drawPin([x, y]: [number, number], pin?: OverlayPin): HTMLElement {
    const node = this.options.doc.createElement('span')
    node.className = 'pin'
    const z = this.zoom
    const size = PIN_PX / z
    const vw = this.options.win.innerWidth
    // No room above a point on screen: the pin hangs below it, its tip up;
    // near the right edge it shifts in.
    const below = y >= 0 && y - size < EDGE_PX / z
    if (below) node.style.borderRadius = '0 999px 999px'
    Object.assign(node.style, {
      left: `${x <= vw ? Math.min(x, vw - size - EDGE_PX / z) : x}px`,
      top: `${below ? y : y - size}px`,
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${11 / z}px`,
      lineHeight: `${size}px`,
      boxShadow: `0 0 0 ${2 / z}px #fff,0 ${2 / z}px ${6 / z}px rgba(0,0,0,.25)`,
    })
    if (pin) {
      // The number as text, never markup; the id never reaches the DOM.
      node.textContent = String(pin.n)
      node.onclick = (event) => {
        this.consume(event)
        this.options.onPin?.({ id: pin.id })
      }
    } else node.dataset.pending = ''
    return node
  }

  private labelFor(tagged: TaggedElement): [string, string?] {
    const [label, suffix] = this.foreign[tagged.tag] ?? [this.labels[tagged.fieldKey]]
    return [typeof label === 'string' && label.trim() ? label : tagged.fieldKey, suffix]
  }

  private drawBox(box: Box): HTMLElement {
    const doc = this.options.doc
    const z = this.zoom
    const px = (n: number) => `${Math.round((n / z) * 100) / 100}px`
    const rect = box.element.getBoundingClientRect()
    const node = doc.createElement('div')
    node.className = 'box'
    node.dataset.kind = box.kind
    const offset = 3 / z
    Object.assign(node.style, {
      left: `${rect.left - offset}px`,
      top: `${rect.top - offset}px`,
      width: `${rect.width + offset * 2}px`,
      height: `${rect.height + offset * 2}px`,
      outline: `${px(2)} solid ${this.theme.outline}`,
      borderRadius: px(3),
      background: box.kind === 'selected' ? SELECTED_TINT : 'transparent',
    })
    // A chip names the field on hover, on selection and where the editor
    // located it (board CampoLocalizar: the located «Título» carries its
    // chip); a highlight outline is a thread pointing at its anchor. A
    // selected element smaller on screen than the chip itself (at low zoom,
    // most lines of text) keeps its outline and tint but shows its chip only
    // while hovered: a row of such chips buried the very elements being
    // picked (acceptance F6). The hovered one always names itself.
    const tooSmall =
      box.kind === 'selected' &&
      box.element !== this.hover &&
      Math.min(rect.width, rect.height) * z < CHIP_HEIGHT_PX
    if (box.label && box.kind !== 'highlight' && !tooSmall) {
      const chip = doc.createElement('span')
      chip.className = 'chip'
      // No room above the element: the chip goes below it (flip); the
      // horizontal shift waits until it is drawn and measurable (render).
      const lift = 27 / z
      const above =
        rect.top - offset - lift >= EDGE_PX / z || rect.bottom + lift > this.options.win.innerHeight
      Object.assign(chip.style, {
        right: px(-5),
        [above ? 'top' : 'bottom']: px(-27),
        height: px(CHIP_HEIGHT_PX),
        padding: `0 ${px(7)}`,
        gap: px(4),
        borderRadius: px(6),
        fontSize: px(12),
        background: this.theme.chip,
        color: this.theme.chipText,
      })
      if (box.kind === 'selected') {
        const icon = doc.createElement('span')
        icon.className = 'icon'
        icon.style.width = px(12)
        icon.style.height = px(12)
        // A constant SVG string of ours, never network data (§7.3).
        icon.innerHTML = CHECK_SVG
        chip.appendChild(icon)
      }
      // Label text is set with textContent: labels come from the editor and
      // are never parsed as markup.
      chip.appendChild(doc.createTextNode(box.label))
      if (box.suffix) {
        const muted = doc.createElement('span')
        muted.className = 'of'
        muted.textContent = box.suffix
        chip.appendChild(muted)
      }
      node.appendChild(chip)
    }
    return node
  }
}

/** `spotOnLarge`: an element taking this share of the viewport is commented as a point (site Comentar's rule). */
const LARGE_SHARE = 0.5

/**
 * Scroll THIS window only, centring `element`; nothing when it is fully in
 * view. Never `scrollIntoView`, which also scrolls every scrollable ancestor
 * across the frame: Zap's editor around its preview frame.
 */
export function reveal(win: Window, element: Element): void {
  const { top, bottom, height } = element.getBoundingClientRect()
  const h = win.innerHeight
  if (top < 0 || bottom > h)
    win.scrollTo?.({ top: win.scrollY + top - Math.max(0, (h - height) / 2), behavior: 'smooth' })
}

/** The chip's on-screen height; a selected element smaller than this shows its chip on hover only. */
const CHIP_HEIGHT_PX = 20
/** How far chips and pins keep from the viewport's edges, on screen. */
const EDGE_PX = 4
/** A pin's on-screen size (SeleccionarElementos board, «Comentar»). */
const PIN_PX = 22

const STYLES = `
.layer { position: fixed; inset: 0; pointer-events: none; }
.box { position: fixed; box-sizing: border-box; pointer-events: none; }
.chip {
  position: absolute; display: inline-flex; align-items: center; white-space: nowrap;
  font-family: Poppins, ui-sans-serif, system-ui, sans-serif; font-weight: 600; line-height: 1;
  letter-spacing: 0; text-transform: none; font-style: normal; box-sizing: border-box;
}
.of { font-weight: 400; opacity: .72; }
.capture { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; display: none; }
.pin {
  position: fixed; box-sizing: border-box; pointer-events: auto; cursor: pointer; text-align: center;
  border-radius: 999px 999px 999px 0; background: #CF8700; color: #fff;
  font-family: Poppins, ui-sans-serif, system-ui, sans-serif; font-weight: 700;
}
.icon { display: inline-flex; flex-shrink: 0; }
.icon svg { width: 100%; height: 100%; display: block; }
`
