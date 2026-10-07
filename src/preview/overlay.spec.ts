import { afterEach, describe, expect, it, vi } from 'vitest'

import { Overlay, OVERLAY_HOST_TAG, reveal } from './overlay'
import { TagIndex } from './tags'

function setup(html: string, extra: { spotOnLarge?: boolean } = {}) {
  document.body.innerHTML = html
  const index = new TagIndex(document)
  index.scan()
  const onInspect = vi.fn()
  const onSelect = vi.fn()
  const onSpot = vi.fn()
  const onPin = vi.fn()
  const overlay = new Overlay({
    doc: document,
    win: window,
    index,
    onInspect,
    onSelect,
    onSpot,
    onPin,
    ...extra,
  })
  overlay.mount()
  overlays.push(overlay)
  return { index, overlay, onInspect, onSelect, onSpot, onPin }
}

const overlays: Overlay[] = []
const $ = (selector: string) => document.querySelector(selector)!

function hover(element: Element) {
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
}

function click(element: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  element.dispatchEvent(event)
  return event
}

afterEach(() => {
  while (overlays.length) overlays.pop()!.destroy()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** jsdom lays nothing out: the box `element` reports, in viewport px. */
function placed(element: Element, top: number, height: number, width = 300) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    left: 0,
    top,
    right: width,
    bottom: top + height,
    width,
    height,
  } as DOMRect)
}

/** The closed shadow root's drawing layer, which `inspect()` summarises. */
const layerOf = (overlay: Overlay) => (overlay as unknown as { layer: HTMLElement }).layer

const PAGE = `
  <h1 data-zap="blog/hola#title">Hola</h1>
  <p data-zap="blog/hola#subtitle"><span id="inner">Sub</span></p>
  <footer id="foot">Pie</footer>
`

describe('Overlay', () => {
  it('draws inside a closed shadow root on its own host', () => {
    setup(PAGE)
    const host = document.querySelector(OVERLAY_HOST_TAG)!
    expect(host).not.toBeNull()
    expect(host.shadowRoot).toBeNull() // closed: site scripts cannot reach in
    expect(host.parentElement).toBe(document.documentElement)
    expect(host.getAttribute('style')).toContain('pointer-events: none !important')
  })

  it('inspect: hover outlines tagged elements with the field label chip', () => {
    const { overlay } = setup(PAGE)
    overlay.setLabels({ title: 'Título' })
    overlay.setMode('inspect')
    hover($('h1'))
    overlay.render()
    expect(overlay.inspect().boxes).toEqual([{ kind: 'hover', label: 'Título' }])

    hover($('#inner')) // inside a tagged element → that element, label falls back to the key
    overlay.render()
    expect(overlay.inspect().boxes).toEqual([{ kind: 'hover', label: 'subtitle' }])

    hover($('#foot')) // untagged → nothing in inspect mode
    overlay.render()
    expect(overlay.inspect().boxes).toEqual([])
  })

  it('divides the 2px outline and the 12px chip by the zoom', () => {
    const { overlay } = setup(PAGE)
    overlay.setMode('inspect')
    hover($('h1'))
    overlay.render()
    expect(overlay.boxStyle(0)!.outline).toBe('2px solid #CF8700')
    overlay.setZoom(0.5)
    overlay.render()
    expect(overlay.boxStyle(0)!.outline).toBe('4px solid #CF8700')
    expect(overlay.inspect().zoom).toBe(0.5)
  })

  it('select: a selected element smaller than the chip shows its chip only while hovered (F6)', () => {
    const { overlay } = setup(PAGE)
    overlay.setLabels({ title: 'Título', subtitle: 'Subtítulo' })
    // jsdom lays nothing out: the h1 is a 300×40 heading, the p a 120×16 line.
    const sizes = new Map<Element, [number, number]>([
      [$('h1'), [300, 40]],
      [$('p'), [120, 16]],
    ])
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const [width, height] = sizes.get(this) ?? [0, 0]
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height } as DOMRect
    })
    try {
      overlay.setMode('select')
      click($('h1'))
      click($('p'), { shiftKey: true })
      hover($('#foot'))
      overlay.render()
      const labels = () =>
        overlay
          .inspect()
          .boxes.filter((b) => b.kind === 'selected')
          .map((b) => b.label)

      // At 100%: the 16px line is smaller than the 20px chip, the heading is not.
      expect(labels()).toEqual(['Título', null])
      // Hovered, the small one names itself.
      hover($('#inner'))
      overlay.render()
      expect(labels()).toEqual(['Título', 'Subtítulo'])
      hover($('#foot'))
      // At 40%, the 40px heading is 16px on screen: its chip goes too.
      overlay.setZoom(0.4)
      overlay.render()
      expect(labels()).toEqual([null, null])
      // At 200% both are big enough.
      overlay.setZoom(2)
      overlay.render()
      expect(labels()).toEqual(['Título', 'Subtítulo'])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('inspect: clicking a tagged element reports it and the page never sees the click', () => {
    const { overlay, onInspect } = setup(PAGE)
    overlay.setMode('inspect')
    const siteHandler = vi.fn()
    $('h1').addEventListener('click', siteHandler)
    const event = click($('h1'))
    expect(event.defaultPrevented).toBe(true)
    expect(siteHandler).not.toHaveBeenCalled()
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ tag: 'blog/hola#title' }))

    // An untagged click passes through untouched.
    const footHandler = vi.fn()
    $('#foot').addEventListener('click', footHandler)
    expect(click($('#foot')).defaultPrevented).toBe(false)
    expect(footHandler).toHaveBeenCalled()
  })

  it('select: click selects, Shift/Cmd adds or removes, Esc clears', () => {
    const { overlay, onSelect } = setup(PAGE)
    overlay.setMode('select')
    click($('h1'))
    expect(onSelect).toHaveBeenLastCalledWith([$('h1')])
    click($('#foot'), { shiftKey: true }) // untagged elements are selectable too
    expect(onSelect).toHaveBeenLastCalledWith([$('h1'), $('#foot')])
    click($('#inner'), { metaKey: true }) // resolves to its tagged parent
    expect(onSelect).toHaveBeenLastCalledWith([$('h1'), $('#foot'), $('p')])
    click($('h1'), { ctrlKey: true }) // toggles off
    expect(onSelect).toHaveBeenLastCalledWith([$('#foot'), $('p')])
    // jsdom lays nothing out (0×0), and a selected element smaller than the
    // chip names itself while hovered (F6, spec below).
    hover($('#inner'))
    overlay.render()
    expect(overlay.inspect().boxes.map((b) => b.kind)).toEqual(['selected', 'selected'])
    expect(overlay.inspect().boxes[1]!.label).toBe('subtitle')

    click($('h1')) // plain click replaces
    expect(onSelect).toHaveBeenLastCalledWith([$('h1')])

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(onSelect).toHaveBeenLastCalledWith([])
    expect(overlay.selection).toEqual([])
  })

  it('select: caps the selection at 20 anchors and swallows every click', () => {
    const many = Array.from({ length: 25 }, (_, i) => `<i id="e${i}">${i}</i>`).join('')
    const { overlay, onSelect } = setup(many)
    overlay.setMode('select')
    const siteHandler = vi.fn()
    document.body.addEventListener('click', siteHandler)
    click($('#e0'))
    for (let i = 1; i < 25; i++) click($(`#e${i}`), { shiftKey: true })
    expect(overlay.selection).toHaveLength(20)
    expect(onSelect.mock.calls.at(-1)![0]).toHaveLength(20)
    expect(siteHandler).not.toHaveBeenCalled()
  })

  it('leaving select mode clears the selection and tells the editor', () => {
    const { overlay, onSelect } = setup(PAGE)
    overlay.setMode('select')
    click($('h1'))
    overlay.setMode('inspect')
    expect(onSelect).toHaveBeenLastCalledWith([])
  })

  it('off: draws nothing and intercepts nothing', () => {
    const { overlay, onInspect } = setup(PAGE)
    overlay.setMode('off')
    hover($('h1'))
    const event = click($('h1'))
    overlay.render()
    expect(event.defaultPrevented).toBe(false)
    expect(onInspect).not.toHaveBeenCalled()
    expect(overlay.inspect().boxes).toEqual([])
  })

  it('focusField outlines every element of the field and scrolls to the first', () => {
    const { overlay, index } = setup(`${PAGE}<h2 data-zap="blog/hola#title">Hola otra vez</h2>`)
    overlay.setMode('inspect')
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const elements = index.byField('blog/hola', 'title').map((t) => t.element)
    const scrollIntoView = vi.fn()
    elements[0]!.scrollIntoView = scrollIntoView
    // Below the fold (jsdom's viewport is 768px tall): centred, this window only.
    placed(elements[0]!, 1000, 40)
    expect(overlay.focusField(elements)).toBe(2)
    overlay.render()
    expect(overlay.inspect().boxes.map((b) => b.kind)).toEqual(['focus', 'focus'])
    expect(scrollTo).toHaveBeenCalledWith({
      top: 1000 - (window.innerHeight - 40) / 2,
      behavior: 'smooth',
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('highlight scrolls this window to the first anchor, never scrollIntoView', () => {
    const { overlay } = setup(PAGE)
    overlay.setMode('inspect')
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const scrollIntoView = vi.fn()
    $('#foot').scrollIntoView = scrollIntoView
    placed($('#foot'), 2000, 20)
    overlay.highlight([$('#foot')])
    expect(scrollTo).toHaveBeenCalledWith({
      top: 2000 - (window.innerHeight - 20) / 2,
      behavior: 'smooth',
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('a located field carries its chip (CampoLocalizar); a highlighted anchor does not', () => {
    const { overlay, index } = setup(PAGE)
    overlay.setLabels({ title: 'Título' })
    overlay.setMode('inspect')
    overlay.focusField(index.byField('blog/hola', 'title').map((t) => t.element))
    overlay.render()
    expect(overlay.inspect().boxes).toEqual([{ kind: 'focus', label: 'Título' }])
    overlay.focusField([])
    overlay.highlight([$('h1')])
    overlay.render()
    expect(overlay.inspect().boxes).toEqual([{ kind: 'highlight', label: null }])
  })

  it('a click on or inside a link never navigates while the overlay is on; off leaves it alone', () => {
    const { overlay, onInspect } = setup(`${PAGE}
      <a id="out" href="/otra"><span id="in">Ir</span></a>
      <a id="cta" href="/x" data-zap="blog/hola#cta">CTA</a>
      <map name="m"><area id="spot" href="/y" alt="y"></map>
      <a id="bare">Sin destino</a>`)
    const site = vi.fn()
    document.body.addEventListener('click', site)
    for (const mode of ['inspect', 'select', 'spot'] as const) {
      overlay.setMode(mode)
      for (const target of ['#in', '#out', '#spot']) {
        const event = click($(target))
        expect([mode, target, event.defaultPrevented]).toEqual([mode, target, true])
      }
    }
    expect(site).not.toHaveBeenCalled()

    // A tagged link still names its field in inspect mode.
    overlay.setMode('inspect')
    expect(click($('#cta')).defaultPrevented).toBe(true)
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ tag: 'blog/hola#cta' }))
    // An anchor without href is no link: an untagged one passes through.
    expect(click($('#bare')).defaultPrevented).toBe(false)

    overlay.setMode('off')
    for (const target of ['#in', '#cta', '#spot']) {
      expect(click($(target)).defaultPrevented).toBe(false)
    }
    expect(site).toHaveBeenCalledTimes(4)
    document.body.removeEventListener('click', site)
  })

  it('no form is submitted while the overlay is on; off leaves it alone', () => {
    const { overlay } = setup(`${PAGE}<form id="f"><button>Enviar</button></form>`)
    const submit = () => {
      const event = new Event('submit', { bubbles: true, cancelable: true })
      $('#f').dispatchEvent(event)
      return event.defaultPrevented
    }
    for (const mode of ['inspect', 'select', 'spot'] as const) {
      overlay.setMode(mode)
      expect([mode, submit()]).toEqual([mode, true])
    }
    overlay.setMode('off')
    expect(submit()).toBe(false)
  })

  it("a field of another record names its record after the label, muted; the page's own does not", () => {
    const { overlay } = setup(
      `${PAGE}<p id="news" data-zap="doc:configuracion#boletin_titulo">Boletín</p>`,
    )
    overlay.setLabels(
      // The page's own labels are by field key: never a foreign field's.
      { title: 'Título', boletin_titulo: 'Etiqueta propia' },
      { 'doc:configuracion#boletin_titulo': ['Título del boletín', 'en Configuración'] },
    )
    overlay.setMode('inspect')
    hover($('#news'))
    overlay.render()
    expect(overlay.inspect().boxes).toEqual([
      { kind: 'hover', label: 'Título del boletínen Configuración' },
    ])
    const chip = layerOf(overlay).querySelector('.chip')!
    expect(chip.firstChild!.textContent).toBe('Título del boletín')
    expect(chip.querySelector('span.of')!.textContent).toBe('en Configuración')

    hover($('h1'))
    overlay.render()
    expect(overlay.inspect().boxes).toEqual([{ kind: 'hover', label: 'Título' }])
    expect(layerOf(overlay).querySelector('.of')).toBeNull()

    const css = (layerOf(overlay).parentNode as ShadowRoot).querySelector('style')!.textContent!
    expect(css).toMatch(/\.of\s*\{\s*font-weight:\s*400;\s*opacity:\s*\.72;\s*\}/)
  })

  it('a chip with no room above its element flips below it', () => {
    const { overlay } = setup(PAGE)
    overlay.setLabels({ title: 'Título', subtitle: 'Subtítulo' })
    overlay.setMode('inspect')
    const chipStyle = () => layerOf(overlay).querySelector<HTMLElement>('.chip')!.style
    placed($('h1'), 0, 40) // flush with the top of the viewport
    hover($('h1'))
    overlay.render()
    expect([chipStyle().top, chipStyle().bottom]).toEqual(['', '-27px'])
    placed($('p'), 200, 40) // room above: the chip sits on top
    hover($('#inner'))
    overlay.render()
    expect([chipStyle().top, chipStyle().bottom]).toEqual(['-27px', ''])
  })

  it('renders labels as text, never markup', () => {
    const { overlay } = setup(PAGE)
    overlay.setLabels({ title: '<img src=x onerror=alert(1)>' })
    overlay.setMode('inspect')
    hover($('h1'))
    overlay.render()
    expect(overlay.inspect().boxes[0]!.label).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('reveal', () => {
  function frame(scrollY = 300, innerHeight = 800) {
    const scrollTo = vi.fn()
    return { win: { innerHeight, scrollY, scrollTo } as unknown as Window, scrollTo }
  }
  function element(top: number, height: number) {
    const el = document.createElement('div')
    el.scrollIntoView = vi.fn()
    placed(el, top, height)
    return el
  }

  it('does nothing for an element fully in view, edges included', () => {
    const { win, scrollTo } = frame()
    for (const [top, height] of [
      [0, 800],
      [100, 200],
      [760, 40],
    ] as const) {
      const el = element(top, height)
      reveal(win, el)
      expect(el.scrollIntoView).not.toHaveBeenCalled()
    }
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it.each([
    ['below the fold', 1000, 100, 300 + 1000 - 350],
    ['partly below', 750, 100, 300 + 750 - 350],
    ['above', -500, 100, 300 - 500 - 350],
    ['partly above', -10, 100, 300 - 10 - 350],
    ['taller than the viewport: its top at the top', -10, 1200, 300 - 10],
  ])('scrolls this window to centre an element %s', (_name, top, height, expected) => {
    const { win, scrollTo } = frame()
    const el = element(top, height)
    reveal(win, el)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: expected, behavior: 'smooth' })
    expect(el.scrollIntoView).not.toHaveBeenCalled()
  })
})

/**
 * Comments: spot mode and numbered pins (§3.3 spot anchors). jsdom lays
 * nothing out, so the document's scroll size and scroll offset are set here.
 */
describe('Overlay — spot mode and pins', () => {
  const restore: Array<() => void> = []
  function layout(size: { w: number; h: number }, scroll: { x: number; y: number }) {
    const root = document.documentElement
    for (const [target, key, value] of [
      [root, 'scrollWidth', size.w],
      [root, 'scrollHeight', size.h],
      [window, 'scrollX', scroll.x],
      [window, 'scrollY', scroll.y],
    ] as const) {
      Object.defineProperty(target, key, { configurable: true, get: () => value })
      restore.push(() => delete (target as unknown as Record<string, unknown>)[key])
    }
  }
  afterEach(() => {
    while (restore.length) restore.pop()!()
  })

  const pinTexts = (overlay: Overlay) => overlay.inspect().pins.map((p) => p.textContent)

  it('a click on the capture layer becomes a point of the whole document, and the site never sees it', () => {
    layout({ w: 1000, h: 4000 }, { x: 0, y: 1000 })
    const { overlay, onSpot } = setup(PAGE)
    const siteHandlers = [vi.fn(), vi.fn(), vi.fn()]
    document.addEventListener('click', siteHandlers[0]!)
    window.addEventListener('click', siteHandlers[1]!)
    document.documentElement.addEventListener('click', siteHandlers[2]!)
    overlay.setMode('spot')
    overlay.render()
    const capture = overlay.inspect().capture!
    expect(capture).not.toBeNull()
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 250,
      clientY: 200,
    })
    capture.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    for (const handler of siteHandlers) expect(handler).not.toHaveBeenCalled()
    // (250 + 0) / 1000, (200 + 1000) / 4000
    expect(onSpot).toHaveBeenCalledWith({
      spot: { x: 0.25, y: 0.3 },
      viewport: { w: 1000, h: 4000 },
    })
    for (const [i, handler] of siteHandlers.entries()) {
      ;[document, window, document.documentElement][i]!.removeEventListener('click', handler)
    }
  })

  it('a click that reaches a site element in spot mode is consumed too, and clamped to 0..1', () => {
    layout({ w: 1000, h: 1000 }, { x: 0, y: 0 })
    const { overlay, onSpot, onInspect } = setup(PAGE)
    overlay.setMode('spot')
    const siteHandler = vi.fn()
    $('h1').addEventListener('click', siteHandler)
    const event = click($('h1'), { clientX: 5000, clientY: -20 })
    expect(event.defaultPrevented).toBe(true)
    expect(siteHandler).not.toHaveBeenCalled()
    expect(onInspect).not.toHaveBeenCalled()
    expect(onSpot).toHaveBeenCalledWith({ spot: { x: 1, y: 0 }, viewport: { w: 1000, h: 1000 } })
  })

  it('draws a pending pin where the click was, without a number, no hover outlines; Esc clears it', () => {
    layout({ w: 1000, h: 4000 }, { x: 0, y: 1000 })
    const { overlay } = setup(PAGE)
    overlay.setMode('spot')
    hover($('h1'))
    click($('h1'), { clientX: 100, clientY: 300 })
    overlay.render()
    expect(overlay.inspect().boxes).toEqual([])
    const [pending] = overlay.inspect().pins
    expect(pending!.dataset.pending).toBe('')
    expect(pending!.textContent).toBe('')
    // Point at the bottom-left corner: back in viewport coordinates.
    expect([pending!.style.left, pending!.style.top]).toEqual(['100px', `${300 - 22}px`])

    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(true)
    overlay.render()
    expect(overlay.inspect().pins).toEqual([])
  })

  it('leaving spot mode removes the capture layer and the pending pin', () => {
    const { overlay } = setup(PAGE)
    overlay.setMode('spot')
    click($('h1'))
    overlay.render()
    expect(overlay.inspect().pins).toHaveLength(1)
    overlay.setMode('inspect')
    overlay.render()
    expect(overlay.inspect().capture).toBeNull()
    expect(overlay.inspect().pins).toEqual([])
  })

  it('draws numbered pins as text: spot pins at their document point, dom pins at the element', () => {
    layout({ w: 1000, h: 4000 }, { x: 10, y: 500 })
    const { overlay } = setup(PAGE)
    vi.spyOn($('h1'), 'getBoundingClientRect').mockReturnValue({
      left: 40,
      top: 60,
    } as DOMRect)
    overlay.setMode('inspect')
    overlay.setPins([
      { id: 'a', n: 1, spot: { x: 0.5, y: 0.25 } },
      { id: 'b', n: 12, element: $('h1') },
    ])
    overlay.render()
    expect(pinTexts(overlay)).toEqual(['1', '12'])
    const [spotPin, domPin] = overlay.inspect().pins
    expect([spotPin!.style.left, spotPin!.style.top]).toEqual(['490px', `${1000 - 500 - 22}px`])
    expect([domPin!.style.left, domPin!.style.top]).toEqual(['40px', `${60 - 22}px`])
    // Redrawn from the current scroll.
    layout({ w: 1000, h: 4000 }, { x: 10, y: 900 })
    overlay.render()
    expect(overlay.inspect().pins[0]!.style.top).toBe(`${1000 - 900 - 22}px`)
    vi.restoreAllMocks()
  })

  it('neither a pin id nor anything but its number reaches the markup', () => {
    const { overlay } = setup(PAGE)
    overlay.setMode('select')
    overlay.setPins([{ id: '<img src=x onerror=alert(1)>', n: 3, spot: { x: 0, y: 0 } }])
    overlay.render()
    const [pin] = overlay.inspect().pins
    expect(pin!.innerHTML).toBe('3')
    expect(pin!.outerHTML).not.toContain('img')
    expect(pin!.querySelector('*')).toBeNull()
  })

  it('divides the pin and its ring by the zoom', () => {
    const { overlay } = setup(PAGE)
    overlay.setMode('inspect')
    overlay.setZoom(0.5)
    overlay.setPins([{ id: 'a', n: 1, spot: { x: 0, y: 0 } }])
    overlay.render()
    const style = overlay.inspect().pins[0]!.style
    expect([style.width, style.fontSize]).toEqual(['44px', '22px'])
    expect(style.boxShadow).toContain('0 0 0 4px')
  })

  it('a dom pin whose element left the page is not drawn', () => {
    const { overlay } = setup(PAGE)
    overlay.setMode('inspect')
    const gone = $('#foot')
    overlay.setPins([
      { id: 'a', n: 1, element: gone },
      { id: 'b', n: 2, spot: { x: 0, y: 0 } },
    ])
    gone.remove()
    overlay.render()
    expect(pinTexts(overlay)).toEqual(['2'])
  })

  it('a pin click reports the pin, is consumed, and is never also a spot', () => {
    const { overlay, onPin, onSpot } = setup(PAGE)
    const siteHandler = vi.fn()
    document.addEventListener('click', siteHandler)
    overlay.setMode('spot')
    overlay.setPins([{ id: 'p-7', n: 7, spot: { x: 0.1, y: 0.1 } }])
    overlay.render()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
    overlay.inspect().pins[0]!.dispatchEvent(event)
    expect(onPin).toHaveBeenCalledWith({ id: 'p-7' })
    expect(onSpot).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    expect(siteHandler).not.toHaveBeenCalled()
    document.removeEventListener('click', siteHandler)
  })

  describe("select with spotOnLarge (the preview's one comment toggle)", () => {
    function viewport(w: number, h: number) {
      const before = [window.innerWidth, window.innerHeight]
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
      restore.push(() => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: before[0] })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: before[1] })
      })
    }
    function sized(element: Element, width: number, height: number) {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width,
        height,
      } as DOMRect)
    }
    const WRAPPED = `<main id="wrap"><h1 data-zap="blog/hola#title">Hola</h1></main>`

    it('a plain click on an element covering half the viewport is a spot, with a pending pin', () => {
      layout({ w: 1000, h: 2000 }, { x: 0, y: 0 })
      viewport(1000, 800)
      const { overlay, onSpot, onSelect } = setup(WRAPPED, { spotOnLarge: true })
      sized($('#wrap'), 1000, 600)
      sized($('h1'), 300, 40)
      overlay.setMode('select')
      const event = click($('#wrap'), { clientX: 500, clientY: 400 })
      expect(event.defaultPrevented).toBe(true)
      expect(onSelect).not.toHaveBeenCalled()
      expect(onSpot).toHaveBeenCalledWith({
        spot: { x: 0.5, y: 0.2 },
        viewport: { w: 1000, h: 2000 },
      })
      overlay.render()
      expect(overlay.inspect().pins).toHaveLength(1)
      expect(overlay.inspect().pins[0]!.dataset.pending).toBe('')

      // A small element after it: a selection, and the pending pin goes.
      click($('h1'))
      expect(onSelect).toHaveBeenLastCalledWith([$('h1')])
      overlay.render()
      expect(overlay.inspect().pins).toEqual([])
      vi.restoreAllMocks()
    })

    it('a click on the body itself is a spot; Esc drops the pending pin', () => {
      layout({ w: 1000, h: 1000 }, { x: 0, y: 0 })
      const { overlay, onSpot } = setup(WRAPPED, { spotOnLarge: true })
      overlay.setMode('select')
      click(document.body, { clientX: 100, clientY: 100 })
      expect(onSpot).toHaveBeenCalledTimes(1)
      const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      window.dispatchEvent(esc)
      expect(esc.defaultPrevented).toBe(true)
      overlay.render()
      expect(overlay.inspect().pins).toEqual([])
    })

    it('a spot clears an existing selection; Shift on a large element still adds it', () => {
      viewport(1000, 800)
      const { overlay, onSpot, onSelect } = setup(WRAPPED, { spotOnLarge: true })
      sized($('#wrap'), 1000, 600)
      sized($('h1'), 300, 40)
      overlay.setMode('select')
      click($('h1'))
      click($('#wrap'), { shiftKey: true })
      expect(onSelect).toHaveBeenLastCalledWith([$('h1'), $('#wrap')])
      expect(onSpot).not.toHaveBeenCalled()
      click($('#wrap'))
      expect(onSelect).toHaveBeenLastCalledWith([])
      expect(onSpot).toHaveBeenCalledTimes(1)
      vi.restoreAllMocks()
    })

    it("without the option (the live site's Comentar decides for itself) a large element is selected", () => {
      viewport(1000, 800)
      const { overlay, onSpot, onSelect } = setup(WRAPPED)
      sized($('#wrap'), 1000, 600)
      overlay.setMode('select')
      click($('#wrap'))
      expect(onSelect).toHaveBeenLastCalledWith([$('#wrap')])
      expect(onSpot).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    })
  })

  it('setPins drops the pending pin; off draws no pin and no capture layer', () => {
    const { overlay } = setup(PAGE)
    overlay.setMode('spot')
    click($('h1'))
    overlay.setPins([{ id: 'a', n: 1, spot: { x: 0, y: 0 } }])
    overlay.render()
    expect(pinTexts(overlay)).toEqual(['1'])
    overlay.setMode('off')
    overlay.render()
    expect(overlay.inspect().pins).toEqual([])
    expect(overlay.inspect().capture).toBeNull()
  })
})
