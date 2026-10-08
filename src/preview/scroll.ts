import type { ScrollAnchor, ScrollPayload } from './protocol'
import type { TagIndex, TaggedElement } from './tags'

/**
 * Scroll sync for Comparar (#953, `scroll-sync` capability): two frames of
 * one page, the published one and the draft, scrolled together by the editor.
 *
 * - While enabled, each scroll of THIS window becomes one `zap:scroll` per
 *   animation frame at most: the position as fractions of the scrollable
 *   range, and the tagged element nearest the viewport's top as an anchor.
 *   Identical consecutive reports are sent once.
 * - `scrollTo` places the page by the anchor when this page has that element,
 *   else by the fraction, instantly (a site's `scroll-behavior: smooth` would
 *   report every step). The scroll events it causes are never reported: the
 *   position it left is remembered, and a report at that position is dropped,
 *   so the other frame never answers its own command (no feedback loop). The
 *   next scroll away from it is the user's and is reported.
 * - No listener until the editor enables it: a page framed by anyone else
 *   stays untouched.
 */
export interface ScrollSync {
  setEnabled(enabled: boolean): void
  scrollTo(target: ScrollPayload): void
  destroy(): void
}

const round = (value: number) => Math.round(value * 1e4) / 1e4

export function createScrollSync(
  win: Window,
  doc: Document,
  index: TagIndex,
  post: (payload: ScrollPayload) => void,
): ScrollSync {
  let enabled = false
  let frame: number | null = null
  let last = ''
  /** Where the last `scrollTo` left the page; a scroll event there is ours. */
  let placed: string | null = null
  const at = () => `${Math.round(win.scrollX)},${Math.round(win.scrollY)}`
  const range = (size: number, view: number) => Math.max(0, size - view)

  function anchor(): ScrollAnchor | undefined {
    let best: TaggedElement | null = null
    let top = Infinity
    for (const tagged of index.elements) {
      const rect = tagged.element.getBoundingClientRect()
      if (rect.height <= 0 || rect.bottom <= 0 || rect.top >= win.innerHeight) continue
      if (Math.abs(rect.top) < Math.abs(top)) {
        best = tagged
        top = rect.top
      }
    }
    if (!best) return undefined
    const { recordRef, fieldKey } = best
    const nth = index.byField(recordRef, fieldKey).indexOf(best)
    return nth < 0 ? undefined : { recordRef, fieldKey, nth, offset: Math.round(top) }
  }

  function measure(): ScrollPayload {
    const root = doc.documentElement
    const fraction = (pos: number, size: number, view: number) => {
      const max = range(size, view)
      return max > 0 ? round(Math.min(1, Math.max(0, pos / max))) : 0
    }
    const payload: ScrollPayload = { y: fraction(win.scrollY, root.scrollHeight, win.innerHeight) }
    if (range(root.scrollWidth, win.innerWidth) > 0) {
      payload.x = fraction(win.scrollX, root.scrollWidth, win.innerWidth)
    }
    const found = anchor()
    if (found) payload.anchor = found
    return payload
  }

  function flush(): void {
    frame = null
    if (!enabled) return
    if (at() === placed) return
    placed = null
    const payload = measure()
    const key = JSON.stringify(payload)
    if (key === last) return
    last = key
    post(payload)
  }

  const onScroll = () => {
    if (!enabled || frame !== null) return
    frame = (
      typeof win.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame(flush)
        : win.setTimeout(flush, 16)
    ) as number
  }

  return {
    setEnabled(next) {
      if (next === enabled) return
      enabled = next
      if (next) {
        win.addEventListener('scroll', onScroll, { passive: true })
        // Where the page is now, so the editor can align the other frame.
        last = ''
        placed = null
        flush()
      } else win.removeEventListener('scroll', onScroll)
    },
    scrollTo({ y, x, anchor: target }) {
      const root = doc.documentElement
      let top = y * range(root.scrollHeight, win.innerHeight)
      const element =
        target && index.byField(target.recordRef, target.fieldKey)[target.nth]?.element
      if (element?.isConnected) {
        top = win.scrollY + element.getBoundingClientRect().top - target!.offset
      }
      const left = x === undefined ? win.scrollX : x * range(root.scrollWidth, win.innerWidth)
      try {
        win.scrollTo({ top, left, behavior: 'instant' as ScrollBehavior })
      } catch {
        // A browser without `instant`: the default behaviour.
        win.scrollTo(left, top)
      }
      placed = at()
      last = JSON.stringify(measure())
    },
    destroy() {
      enabled = false
      win.removeEventListener('scroll', onScroll)
    },
  }
}
