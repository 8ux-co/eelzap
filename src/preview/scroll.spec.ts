import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScrollSync, type ScrollSync } from './scroll'
import type { ScrollPayload } from './protocol'
import { TagIndex } from './tags'

/** A page 4800px tall in an 800px viewport: 4000px of scrollable range. */
const VIEW = 800
const HEIGHT = 4800

const syncs: ScrollSync[] = []
afterEach(() => {
  while (syncs.length) syncs.pop()!.destroy()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * jsdom neither lays out nor scrolls: a window whose `scrollTo` moves it and
 * fires `scroll` as a browser does, and elements placed at document offsets.
 */
function setup(
  html: string,
  layout: Record<string, [top: number, height: number]>,
  size = { w: 1000, h: HEIGHT },
) {
  vi.useFakeTimers()
  document.body.innerHTML = html
  const root = document.documentElement
  vi.spyOn(root, 'scrollHeight', 'get').mockReturnValue(size.h)
  vi.spyOn(root, 'scrollWidth', 'get').mockReturnValue(size.w)
  const events = new EventTarget()
  const win = {
    scrollX: 0,
    scrollY: 0,
    innerWidth: 1000,
    innerHeight: VIEW,
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events)),
    setTimeout: vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms)),
    scrollTo: vi.fn((options: ScrollToOptions) => {
      win.scrollY = Math.min(Math.max(0, options.top ?? win.scrollY), size.h - VIEW)
      win.scrollX = Math.min(Math.max(0, options.left ?? win.scrollX), size.w - 1000)
      events.dispatchEvent(new Event('scroll'))
    }),
  }
  // Read at call time, so a spec can move an element (a reflow).
  const boxes: Record<string, [number, number]> = { ...layout }
  for (const id of Object.keys(boxes)) {
    vi.spyOn(document.getElementById(id)!, 'getBoundingClientRect').mockImplementation(() => {
      const [top, height] = boxes[id]!
      return { top: top - win.scrollY, bottom: top - win.scrollY + height, height } as DOMRect
    })
  }
  const index = new TagIndex(document)
  index.scan()
  const posted: ScrollPayload[] = []
  const sync = createScrollSync(win as unknown as Window, document, index, (p) => posted.push(p))
  syncs.push(sync)
  /** The user scrolls to `y`: a few scroll events, then the next frame. */
  const userScroll = (y: number) => {
    win.scrollY = y
    for (let i = 0; i < 3; i++) events.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(16)
  }
  return { win, sync, posted, userScroll, events, boxes }
}

const PAGE = `
  <h1 id="a" data-zap="blog/hola#title">Hola</h1>
  <p id="b" data-zap="blog/hola#body">Cuerpo</p>
  <h2 id="c" data-zap="blog/hola#title">Hola otra vez</h2>
  <p id="d" data-zap="blog/hola#footer">Pie</p>
`
const LAYOUT = {
  a: [100, 300],
  b: [1000, 1500],
  c: [3000, 100],
  d: [3400, 100],
} as const satisfies Record<string, [number, number]>

describe('scroll sync', () => {
  it('listens to nothing until enabled, then says where the page is', () => {
    const { win, sync, posted, userScroll } = setup(PAGE, LAYOUT)
    userScroll(200)
    expect(posted).toEqual([])
    expect(win.addEventListener).not.toHaveBeenCalled()
    sync.setEnabled(true)
    expect(posted).toEqual([
      { y: 0.05, anchor: { recordRef: 'blog/hola', fieldKey: 'title', nth: 0, offset: -100 } },
    ])
  })

  it('reports a user scroll once per frame, as a fraction and the field nearest the top', () => {
    const { sync, posted, userScroll } = setup(PAGE, LAYOUT)
    sync.setEnabled(true)
    posted.length = 0
    userScroll(2000)
    expect(posted).toEqual([
      { y: 0.5, anchor: { recordRef: 'blog/hola', fieldKey: 'body', nth: 0, offset: -1000 } },
    ])
    // The same place again is not news.
    userScroll(2000)
    expect(posted).toHaveLength(1)
  })

  it('measures once per frame, however many scroll events it brings', () => {
    const { win, sync, events } = setup(PAGE, LAYOUT)
    sync.setEnabled(true)
    for (const y of [100, 200, 300, 400]) {
      win.scrollY = y
      events.dispatchEvent(new Event('scroll'))
    }
    expect(win.setTimeout).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(16)
    win.scrollY = 500
    events.dispatchEvent(new Event('scroll'))
    expect(win.setTimeout).toHaveBeenCalledTimes(2)
  })

  it('never anchors to an element out of view, however near the top it ends', () => {
    const { sync, posted, userScroll } = setup(PAGE, LAYOUT)
    sync.setEnabled(true)
    // `c` ended 50px above the viewport; `d` starts 250px into it.
    userScroll(3150)
    expect(posted.at(-1)!.anchor).toEqual({
      recordRef: 'blog/hola',
      fieldKey: 'footer',
      nth: 0,
      offset: 250,
    })
  })

  it('names which element of a repeated field the anchor is', () => {
    const { sync, posted, userScroll } = setup(PAGE, LAYOUT)
    sync.setEnabled(true)
    userScroll(2950)
    expect(posted.at(-1)!.anchor).toEqual({
      recordRef: 'blog/hola',
      fieldKey: 'title',
      nth: 1,
      offset: 50,
    })
  })

  it('reports x only for a page that scrolls sideways', () => {
    const { sync, posted } = setup(PAGE, LAYOUT, { w: 2000, h: HEIGHT })
    sync.setEnabled(true)
    expect(posted[0]).toMatchObject({ y: 0, x: 0 })
  })

  it('scrollTo places the page by fraction, instantly, and never echoes it back', () => {
    const { win, sync, posted, userScroll } = setup(PAGE, LAYOUT)
    sync.setEnabled(true)
    posted.length = 0
    sync.scrollTo({ y: 0.25 })
    expect(win.scrollTo).toHaveBeenCalledWith({ top: 1000, left: 0, behavior: 'instant' })
    vi.advanceTimersByTime(16)
    expect(posted).toEqual([])
    // The next scroll away from it is the user's.
    userScroll(1200)
    expect(posted).toEqual([{ y: 0.3, anchor: expect.objectContaining({ fieldKey: 'body' }) }])
  })

  it('a scroll event at the place scrollTo left is ours, even if the page reflowed meanwhile', () => {
    const { sync, posted, boxes } = setup(PAGE, LAYOUT)
    sync.setEnabled(true)
    posted.length = 0
    sync.scrollTo({ y: 0.5 })
    // An image above loaded before the frame: the anchor moved, the scroll did not.
    boxes.b = [1100, 1500]
    vi.advanceTimersByTime(16)
    expect(posted).toEqual([])
  })

  it('scrollTo by anchor aligns that element, the fraction only when the page lacks it', () => {
    const { win, sync, posted } = setup(PAGE, LAYOUT)
    win.scrollY = 500
    sync.scrollTo({
      y: 0.9,
      anchor: { recordRef: 'blog/hola', fieldKey: 'title', nth: 1, offset: 40 },
    })
    expect(win.scrollY).toBe(3000 - 40)
    sync.scrollTo({
      y: 0.25,
      anchor: { recordRef: 'blog/hola', fieldKey: 'title', nth: 2, offset: 40 },
    })
    expect(win.scrollY).toBe(1000)
    sync.scrollTo({
      y: 0.9,
      anchor: { recordRef: 'doc:home', fieldKey: 'title', nth: 0, offset: 0 },
    })
    expect(win.scrollY).toBe(3600)
    expect(posted).toEqual([])
  })

  it('a scrollTo while sync is on cannot loop: neither frame hears its own command', () => {
    // Two pages of different lengths, each told where the other went.
    const a = setup(PAGE, LAYOUT)
    const b = setup(PAGE, { a: [100, 300], b: [1400, 1800], c: [3600, 100] }, { w: 1000, h: 5600 })
    a.sync.setEnabled(true)
    b.sync.setEnabled(true)
    a.posted.length = 0
    b.posted.length = 0
    a.userScroll(2000)
    b.sync.scrollTo(a.posted.at(-1)!)
    expect(b.win.scrollY).toBe(1400 + 1000)
    vi.advanceTimersByTime(100)
    expect(b.posted).toEqual([])
    expect(a.posted).toHaveLength(1)
  })

  it('disabled or destroyed, scrolling reports nothing and the listener is gone', () => {
    const { win, sync, posted, userScroll } = setup(PAGE, LAYOUT)
    sync.setEnabled(true)
    posted.length = 0
    sync.setEnabled(false)
    expect(win.removeEventListener).toHaveBeenCalledTimes(1)
    userScroll(1000)
    expect(posted).toEqual([])
    sync.setEnabled(true)
    posted.length = 0
    sync.destroy()
    expect(win.removeEventListener).toHaveBeenCalledTimes(2)
    userScroll(3000)
    expect(posted).toEqual([])
  })
})
