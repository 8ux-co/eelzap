import { splitStega } from '../stega'
import type { PreviewValue, ValuesPayload } from './protocol'
import {
  isSafeImageUrl,
  isSafeLinkUrl,
  isSafeSrcset,
  richTextToText,
  sanitizeRichText,
} from './sanitize'
import type { TagIndex, TaggedElement } from './tags'

/**
 * Draft value substitution (`zap:values`, §2.4 "Draft values").
 *
 * What is touched, and nothing else:
 *
 * - text (`string`, `number`, `boolean`, `{ text }`) → `textContent`; on an
 *   `<img>` it becomes `alt` (an image tagged with an alt-text field).
 * - `{ image }` → `src`, `srcset` and `alt` of the element when it is an
 *   `<img>`, else of its first descendant `<img>`; `<source>` siblings in a
 *   `<picture>` lose `srcset` so the browser actually shows the new `src`.
 *   URLs must be http(s) (relative resolves against the page).
 * - `{ html }` → sanitised children (never `innerHTML` on the live node), ONLY
 *   when the element carries `data-zap-html`; otherwise its plain text.
 * - `{ url }` (a URL field) and `{ email }` (an EMAIL field, as `mailto:`) →
 *   the `href` of the element when it is an `<a>`, else of its first
 *   descendant `<a>`; the link's label stays the site's. With no link, the
 *   address is the text. Only http(s), mailto and tel links. (An image field
 *   is `{ image }`, above: its `src`, never its text.)
 * - `null` → empty text; an image keeps what it had.
 *
 * Never an attribute other than `href`, `src`, `srcset` and `alt`, never a
 * style, never an event handler.
 *
 * An element found by a stega marker (`source: 'stega'`) gets text only, and
 * only in the text node that carries the marker, which keeps it: the rest of
 * the element (other text, other fields, markup) is the site's. Rich text and
 * images found that way are left to the site's `onValues` handler.
 *
 * ## Formatting is the editor's job
 *
 * Numbers, dates and enum labels arrive already formatted (`PreviewValue`
 * says why): the browser core has no locale data, no field types and a size
 * budget, and the editor already has the suite's formatters.
 *
 * ## Re-application
 *
 * The last value per field is remembered, so when the site re-renders a tagged
 * node (hydration, client routing) `reapply()` writes it again. An element is
 * rewritten only when it differs from what we would write, so our own writes
 * — which the mutation observer also sees — settle after one pass.
 */

interface Desired {
  locale: string
  value: PreviewValue
}

export class ValueApplier {
  private desired = new Map<string, Desired>()
  private appliedHtml = new WeakMap<Element, { source: string; output: string }>()

  constructor(
    private readonly index: TagIndex,
    private readonly doc: Document,
  ) {}

  /** Remember and apply a patch. Returns how many elements were written. */
  apply(payload: ValuesPayload): number {
    let written = 0
    for (const [fieldKey, value] of Object.entries(payload.patch)) {
      this.desired.set(`${payload.recordRef}#${fieldKey}`, { locale: payload.locale, value })
      for (const tagged of this.index.byField(payload.recordRef, fieldKey)) {
        if (this.write(tagged, payload.locale, value)) written++
      }
    }
    return written
  }

  /** Write every remembered value again where the page drifted from it. */
  reapply(): number {
    let written = 0
    for (const tagged of this.index.elements) {
      const desired = this.desired.get(tagged.tag)
      if (desired && this.write(tagged, desired.locale, desired.value)) written++
    }
    return written
  }

  private write(tagged: TaggedElement, locale: string, value: PreviewValue): boolean {
    // An element pinned to another locale shows that locale's copy; leave it.
    if (tagged.locale && tagged.locale !== locale) return false
    const element = tagged.element

    if (tagged.textNode) {
      const text = plainText(value)
      if (text === null) return false
      const node = tagged.textNode
      // The node is the field's own text; keep the whitespace a template put before it.
      const split = splitStega(node.data)
      const next = /^\s*/.exec(split.text)![0] + text + split.markers
      if (node.data === next) return false
      node.data = next
      return true
    }

    if (value !== null && typeof value === 'object' && 'image' in value) {
      return writeImage(element, value.image, this.doc.baseURI)
    }

    if (value !== null && typeof value === 'object' && 'html' in value) {
      if (tagged.html) return this.writeHtml(element, value.html)
      return writeText(element, richTextToText(value.html, this.doc))
    }

    if (value !== null && typeof value === 'object' && ('url' in value || 'email' in value)) {
      return writeLink(element, value, this.doc.baseURI)
    }

    const text = plainText(value) ?? ''
    if (isImg(element)) return setAttr(element, 'alt', text)
    return writeText(element, text)
  }

  private writeHtml(element: Element, html: string): boolean {
    // Unchanged when the source is the one we last wrote AND the node still
    // holds exactly our output (the site did not re-render it since).
    const last = this.appliedHtml.get(element)
    if (last && last.source === html && last.output === element.innerHTML) return false
    element.replaceChildren(sanitizeRichText(html, this.doc))
    this.appliedHtml.set(element, { source: html, output: element.innerHTML })
    return true
  }
}

/** A value as plain text, or null for the shapes that are not text (html, image). */
function plainText(value: PreviewValue): string | null {
  if (value === null || typeof value !== 'object') return value === null ? '' : String(value)
  const v = value as { text?: string; url?: string; email?: string }
  return v.text ?? v.url ?? v.email ?? null
}

/** A URL or EMAIL value: the `href` of the link, never its label. */
function writeLink(element: Element, value: { url: string } | { email: string }, base: string) {
  const email = 'email' in value
  const address = email ? value.email : value.url
  const link = element.localName === 'a' ? element : element.querySelector('a')
  if (!link) return writeText(element, address)
  const href = email && address ? `mailto:${address}` : address
  return isSafeLinkUrl(href, base) && setAttr(link, 'href', href)
}

function isImg(element: Element): element is HTMLImageElement {
  return element.localName === 'img'
}

function writeText(element: Element, text: string): boolean {
  if (element.textContent === text) return false
  element.textContent = text
  return true
}

function setAttr(element: Element, name: string, value: string): boolean {
  if (element.getAttribute(name) === value) return false
  element.setAttribute(name, value)
  return true
}

function writeImage(
  element: Element,
  image: { src?: string | null; srcset?: string | null; alt?: string | null },
  base: string,
): boolean {
  const img = isImg(element) ? element : element.querySelector('img')
  if (!img) return false
  let changed = false
  if (image.src && isSafeImageUrl(image.src, base)) {
    changed = setAttr(img, 'src', image.src) || changed
    const picture = img.parentElement?.localName === 'picture' ? img.parentElement : null
    if (picture) {
      for (const source of Array.from(picture.children)) {
        if (source.localName === 'source' && source.hasAttribute('srcset')) {
          source.removeAttribute('srcset')
          changed = true
        }
      }
    }
    if (image.srcset === undefined || image.srcset === null) {
      // A stale srcset would win over the new src.
      if (img.hasAttribute('srcset')) {
        img.removeAttribute('srcset')
        changed = true
      }
    }
  }
  if (image.srcset && isSafeSrcset(image.srcset, base)) {
    changed = setAttr(img, 'srcset', image.srcset) || changed
  }
  if (typeof image.alt === 'string') changed = setAttr(img, 'alt', image.alt) || changed
  return changed
}
