/**
 * The allowlist sanitiser for rich-text substitution (§2.4 "Draft values",
 * §7.2 "Rich text substitution").
 *
 * ## Why this is not "the delivery API's allowlist"
 *
 * The spec says to sanitise "with the same allowlist the delivery API
 * applies". The delivery API applies NONE: `apps/zap/src/lib/cms/rich-text-media.ts`
 * strips `<script>…</script>` and nothing else, on purpose (its header: an
 * allowlist would drop `data-media-id` and change bytes, flipping every
 * delivery ETag). The suite's real allowlist is `@eel/ui-web`'s
 * `sanitizeRichTextHtml`, a regex sanitiser for Swarm/Wrap editor HTML whose
 * `src` rule admits only the suite's own file route — Zap rich text points at
 * R2 media URLs, so reusing it verbatim would blank every image.
 *
 * So the allowlist lives HERE, as the one source of truth for HTML that Zap
 * puts into a customer page: the tags and attributes Zap's rich-text editor
 * emits (Tiptap StarterKit + link, underline, text-align, the media image
 * with `data-media-id`), nothing else. Constants are exported so a server-side
 * twin, if one is ever needed, imports them rather than copying.
 *
 * ## DOM-based, not regex
 *
 * The page is a real browser, so the HTML is parsed by the browser's own
 * parser into an INERT `<template>` (no script runs, no image loads, no
 * handler fires while parsing) and the resulting tree is walked: disallowed
 * elements are dropped with their content (script-like) or unwrapped
 * (formatting-like), every attribute not on the list is removed, and URL
 * attributes are re-parsed with `URL` so `java\tscript:` and friends are
 * judged by the scheme the browser would actually use.
 */

/** Elements kept as they are. Everything else is unwrapped or dropped. */
export const RICH_TEXT_ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'a',
  'span',
  'img',
])

/** Elements removed WITH their content: executable, embedding or form markup. */
export const RICH_TEXT_DROPPED_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'noscript',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'meta',
  'base',
  'title',
  'head',
])

/** Attributes kept, per element (`*` applies to every allowed element). */
export const RICH_TEXT_ALLOWED_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  '*': new Set(['title', 'style']),
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'data-media-id']),
}

/** `style` survives only as text alignment (the TextAlign extension). */
const ALLOWED_STYLE = /^\s*text-align\s*:\s*(left|right|center|justify)\s*;?\s*$/i
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const IMAGE_SCHEMES = new Set(['http:', 'https:'])
const DIMENSION = /^\d{1,5}$/
const MEDIA_ID = /^[A-Za-z0-9-]{1,64}$/

/**
 * Is `value` a URL on one of `schemes` once the browser parses it? Relative
 * URLs resolve against the document's base (the customer page), which is
 * always http(s).
 */
export function isSafeUrl(value: string, schemes: ReadonlySet<string>, base?: string): boolean {
  try {
    const url = new URL(value, base ?? 'https://base.invalid/')
    return schemes.has(url.protocol)
  } catch {
    return false
  }
}

/** A link target the page may carry: http(s), mailto or tel. */
export function isSafeLinkUrl(value: string, base?: string): boolean {
  return isSafeUrl(value, LINK_SCHEMES, base)
}

export function isSafeImageUrl(value: string, base?: string): boolean {
  return isSafeUrl(value, IMAGE_SCHEMES, base)
}

/** Every candidate URL in a `srcset` must be a safe image URL. */
export function isSafeSrcset(value: string, base?: string): boolean {
  const candidates = value.split(',').map((part) => part.trim().split(/\s+/)[0] ?? '')
  return candidates.length > 0 && candidates.every((url) => url !== '' && isSafeImageUrl(url, base))
}

function cleanAttributes(element: Element, tag: string, base: string | undefined): void {
  const allowed = RICH_TEXT_ALLOWED_ATTRS[tag]
  const global = RICH_TEXT_ALLOWED_ATTRS['*']!
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()
    const value = attribute.value
    let keep = global.has(name) || (allowed?.has(name) ?? false)
    if (keep && name === 'style') keep = ALLOWED_STYLE.test(value)
    if (keep && name === 'href') keep = isSafeUrl(value, LINK_SCHEMES, base)
    if (keep && name === 'src') keep = isSafeImageUrl(value, base)
    if (keep && name === 'target') keep = value === '_blank'
    if (keep && (name === 'width' || name === 'height')) keep = DIMENSION.test(value)
    if (keep && name === 'data-media-id') keep = MEDIA_ID.test(value)
    if (!keep) element.removeAttribute(attribute.name)
  }
  if (tag === 'a' && element.getAttribute('target') === '_blank') {
    element.setAttribute('rel', 'noopener noreferrer')
  } else if (tag === 'a') {
    element.removeAttribute('rel')
  }
}

function walk(parent: ParentNode, base: string | undefined): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 3 /* TEXT */) continue
    if (node.nodeType !== 1 /* ELEMENT */) {
      // Comments, processing instructions, CDATA: never kept.
      node.parentNode?.removeChild(node)
      continue
    }
    const element = node as Element
    const tag = element.localName.toLowerCase()
    const foreign = element.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    if (foreign || RICH_TEXT_DROPPED_TAGS.has(tag)) {
      element.remove()
      continue
    }
    walk(element, base)
    if (!RICH_TEXT_ALLOWED_TAGS.has(tag)) {
      // Unknown formatting (div, section, font, …): keep the text, drop the tag.
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }
    cleanAttributes(element, tag, base)
    // An image whose src did not survive is dropped, not left broken.
    if (tag === 'img' && !element.hasAttribute('src')) element.remove()
  }
}

/**
 * Sanitise `html` into a fragment owned by `doc`, ready for
 * `element.replaceChildren(fragment)`. Never sets `innerHTML` on a live node.
 */
export function sanitizeRichText(
  html: string,
  doc: Document,
  base: string | undefined = doc.baseURI,
): DocumentFragment {
  const template = doc.createElement('template')
  template.innerHTML = html
  const content = template.content
  walk(content, base)
  return content
}

/** The sanitised HTML as a string (for tests and for comparisons). */
export function sanitizeRichTextToString(html: string, doc: Document): string {
  const holder = doc.createElement('div')
  holder.appendChild(sanitizeRichText(html, doc))
  return holder.innerHTML
}

/** Plain text of a rich-text value, for an element that did not opt into HTML. */
export function richTextToText(html: string, doc: Document): string {
  // Through the sanitiser first, so the text of a dropped <script> or <style>
  // never shows up as page copy.
  return sanitizeRichText(html, doc).textContent ?? ''
}
