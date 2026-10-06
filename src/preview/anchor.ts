import {
  MAX_QUOTE_CONTEXT,
  MAX_QUOTE_EXACT,
  MAX_SELECTOR_BYTES,
  utf8Length,
  type DomAnchor,
  type PageAnchor,
  type TextQuote,
} from './protocol'
import type { TagIndex, TaggedElement } from './tags'

/**
 * Anchors for change requests (§3.3 "Anchors"): the `dom` layer is captured
 * here, in the page, never by the server. Re-finding goes tag → selector →
 * text quote → rectangle.
 */

/** `CSS.escape`, with a fallback for environments without it. */
export function cssEscape(value: string): string {
  const native = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape
  if (native) return native(value)
  // The CSSOM `serialize an identifier` algorithm.
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i)
    const code = value.charCodeAt(i)
    const digit = code >= 48 && code <= 57
    if (code === 0) out += '�'
    else if (
      (code >= 1 && code <= 31) ||
      code === 127 ||
      (i === 0 && digit) ||
      (i === 1 && digit && value.charCodeAt(0) === 45)
    ) {
      out += `\\${code.toString(16)} `
    } else if (i === 0 && value.length === 1 && code === 45) out += `\\${ch}`
    else if (code >= 128 || code === 45 || code === 95 || digit || /[A-Za-z]/.test(ch)) out += ch
    else out += `\\${ch}`
  }
  return out
}

/**
 * `querySelectorAll` that never throws: a selector that did not come from
 * `buildSelector` in THIS page (a stored anchor, a message) may be malformed
 * or hostile, and a SyntaxError must not take the overlay down (§7 audit).
 */
export function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector))
  } catch {
    return []
  }
}

/** Stable-looking ids only: framework-generated ids (`:r1:`, `radix-…7`) change per render. */
function usableId(element: Element): string | null {
  const id = element.getAttribute('id')
  if (!id || id.length > 64 || /^[:\d]|:|\d{3,}/.test(id)) return null
  return id
}

function segment(element: Element): string {
  const tag = element.localName
  const parent = element.parentElement
  if (!parent) return tag
  let index = 0
  let count = 0
  for (const sibling of Array.from(parent.children)) {
    if (sibling.localName !== tag) continue
    count++
    if (sibling === element) index = count
  }
  return count > 1 ? `${tag}:nth-of-type(${index})` : tag
}

function isUnique(doc: Document, selector: string, element: Element): boolean {
  const found = safeQueryAll(doc, selector)
  return found.length === 1 && found[0] === element
}

/**
 * A short CSS selector that matches exactly `element` today, or null when no
 * selector under 1 KB does.
 *
 * Walks up from the element, one `tag:nth-of-type(n)` segment per level, and
 * stops at the first ancestor with a usable id or a `data-zap*` attribute
 * (both are things the site chose to name, so they outlive a redesign better
 * than a position does), or as soon as the path is unique. Classes are left
 * out on purpose: utility and hashed class names change on every deploy.
 */
export function buildSelector(element: Element, doc: Document): string | null {
  const ownId = usableId(element)
  if (ownId) {
    const selector = `#${cssEscape(ownId)}`
    if (isUnique(doc, selector, element)) return selector
  }
  const parts: string[] = []
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.localName === 'html') break
    if (node !== element) {
      const id = usableId(node)
      if (id) {
        const candidate = [`#${cssEscape(id)}`, ...parts].join(' > ')
        if (isUnique(doc, candidate, element)) return fit(candidate)
      }
      const zap = node.getAttribute('data-zap') ?? node.getAttribute('data-zap-entry')
      const zapAttr = node.hasAttribute('data-zap') ? 'data-zap' : 'data-zap-entry'
      if (zap) {
        const candidate = [`[${zapAttr}="${cssEscape(zap)}"]`, ...parts].join(' > ')
        if (isUnique(doc, candidate, element)) return fit(candidate)
      }
    }
    parts.unshift(segment(node))
    const candidate = parts.join(' > ')
    if (isUnique(doc, candidate, element)) return fit(candidate)
  }
  const full = parts.join(' > ')
  return full && isUnique(doc, full, element) ? fit(full) : null
}

function fit(selector: string): string | null {
  return utf8Length(selector) <= MAX_SELECTOR_BYTES ? selector : null
}

/** Collapse whitespace the way a reader sees text. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** W3C TextQuoteSelector-shaped quote: the element's text plus 32 chars around it. */
export function textQuoteFor(element: Element, doc: Document): TextQuote | null {
  const exact = normalizeText(element.textContent ?? '').slice(0, MAX_QUOTE_EXACT)
  if (!exact) return null
  let prefix = ''
  let suffix = ''
  const body = doc.body
  if (body && body.contains(element) && typeof doc.createRange === 'function') {
    try {
      const before = doc.createRange()
      before.setStart(body, 0)
      before.setEndBefore(element)
      prefix = normalizeText(before.toString()).slice(-MAX_QUOTE_CONTEXT)
      const after = doc.createRange()
      after.setStartAfter(element)
      after.setEnd(body, body.childNodes.length)
      suffix = normalizeText(after.toString()).slice(0, MAX_QUOTE_CONTEXT)
    } catch {
      prefix = ''
      suffix = ''
    }
  }
  return { exact, prefix, suffix }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function pageSize(doc: Document): { w: number; h: number } {
  const root = doc.documentElement
  return {
    w: Math.max(root.scrollWidth, root.clientWidth, 1),
    h: Math.max(root.scrollHeight, root.clientHeight, 1),
  }
}

/** The element's box as fractions of the whole page (not the viewport). */
export function normalizedRect(element: Element, doc: Document, win: Window) {
  const box = element.getBoundingClientRect()
  const size = pageSize(doc)
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return {
    rect: {
      x: round(clamp((box.left + win.scrollX) / size.w, -1, 2)),
      y: round(clamp((box.top + win.scrollY) / size.h, -1, 2)),
      w: round(clamp(box.width / size.w, 0, 2)),
      h: round(clamp(box.height / size.h, 0, 2)),
    },
    viewport: size,
  }
}

export function buildDomAnchor(
  element: Element,
  tagged: TaggedElement | null,
  doc: Document,
  win: Window,
): DomAnchor {
  return {
    tag: tagged?.tag ?? null,
    selector: buildSelector(element, doc),
    textQuote: textQuoteFor(element, doc),
    ...normalizedRect(element, doc, win),
  }
}

/**
 * The anchor for a selected element: a `field` layer when the element is (or
 * sits inside) a tagged field, and always a `dom` layer.
 */
export function buildAnchor(
  element: Element,
  index: TagIndex,
  pageUrl: string,
  doc: Document,
  win: Window,
): PageAnchor {
  const tagged = index.get(element)
  return {
    field: tagged
      ? { recordRef: tagged.recordRef, key: tagged.fieldKey, locale: tagged.locale }
      : null,
    dom: buildDomAnchor(element, tagged, doc, win),
    pageUrl,
  }
}

/**
 * Re-find an anchor's element: the tag first, then the selector, then the
 * text quote, then the rectangle. Never throws.
 */
export function findAnchorElement(
  anchor: DomAnchor,
  index: TagIndex,
  doc: Document,
  win: Window,
): Element | null {
  if (anchor.tag) {
    const hash = anchor.tag.lastIndexOf('#')
    const tagged = index.byField(anchor.tag.slice(0, hash), anchor.tag.slice(hash + 1))
    if (tagged.length === 1) return tagged[0]!.element
    if (tagged.length > 1 && anchor.textQuote) {
      const exact = anchor.textQuote.exact
      const match = tagged.find((t) => normalizeText(t.element.textContent ?? '') === exact)
      if (match) return match.element
    }
    if (tagged.length > 0) return tagged[0]!.element
  }

  if (anchor.selector) {
    const found = safeQueryAll(doc, anchor.selector)
    if (found.length === 1) return found[0]!
  }

  if (anchor.textQuote && anchor.textQuote.exact.length >= 3 && doc.body) {
    const exact = anchor.textQuote.exact
    let best: Element | null = null
    let bestLength = Infinity
    for (const element of Array.from(doc.body.getElementsByTagName('*'))) {
      const text = normalizeText(element.textContent ?? '')
      if (text.length < bestLength && text.includes(exact)) {
        best = element
        bestLength = text.length
      }
    }
    if (best) return best
  }

  const fromPoint = (doc as { elementFromPoint?: Document['elementFromPoint'] }).elementFromPoint
  if (typeof fromPoint === 'function') {
    const size = pageSize(doc)
    const x = (anchor.rect.x + anchor.rect.w / 2) * size.w - win.scrollX
    const y = (anchor.rect.y + anchor.rect.h / 2) * size.h - win.scrollY
    if (x >= 0 && y >= 0 && x <= win.innerWidth && y <= win.innerHeight) {
      try {
        return fromPoint.call(doc, x, y)
      } catch {
        return null
      }
    }
  }
  return null
}
