import { cleanStega } from '../../stega'
import { findAnchorElement, normalizeText } from '../anchor'
import type { OverlayPin } from '../overlay'
import { isRecordRef, parseRecordRef, type DomAnchor, type PageAnchor } from '../protocol'
import type { TagIndex, TaggedElement } from '../tags'
import type { ApiAnchor, CreateBody, DraftBody, FieldInfo, OnPage, OnPageAnchor } from './api'

/**
 * What «Editar» and «Comentar» send, decided in the page (zap-cms-v2 §3.3,
 * §3.4). Pure functions over the DOM and the `on-page` answer, so each rule is
 * a spec:
 *
 * - **What can be edited or proposed.** Only ONE tagged element whose field
 *   is TEXT or LONG_TEXT (edited in place, `contenteditable`) or NUMBER or URL
 *   (a small input), and never on `data-zap-html` (rich text). The field types
 *   come from Zap's `on-page` read (the site's schema for the records tagged
 *   on the page), never from the page's markup.
 * - **Which record** a thread lands on: the element's own tag, else the
 *   nearest `data-zap-entry`, else the record the page tags most.
 * - **Anchors** are the package's own (`buildAnchor`), clamped to the request
 *   schema's limits, with the `field` layer only for the target record; or a
 *   point of the page (`spotAnchor`).
 * - **The payloads.** «Comentar»: a plain comment, or with «Solicitar cambio»
 *   a change request, which alone may carry a proposed value. «Editar»: the
 *   new value, saved to the draft. The page's address goes once, as `pageUrl`.
 * - **The pins**: the open threads made on this page with an element or a
 *   point, oldest first, numbered from 1, as the editor's Comentarios list
 *   numbers them (`numberPins` in Zap).
 */

export const SUGGESTIBLE_TYPES = ['TEXT', 'LONG_TEXT', 'NUMBER', 'URL'] as const

export type EditKind = 'text' | 'input'

/** How a field can be edited in place, or null for comment only. */
export function editKindFor(
  tagged: TaggedElement | null,
  field: FieldInfo | null | undefined,
): EditKind | null {
  if (!tagged || !field || tagged.html) return null
  if (field.type === 'TEXT' || field.type === 'LONG_TEXT') return 'text'
  if (field.type === 'NUMBER' || field.type === 'URL') return 'input'
  return null
}

/** The field of a tagged element, from the `on-page` schema. */
export function fieldOf(
  data: Pick<OnPage, 'fields'> | null,
  tagged: TaggedElement | null,
): FieldInfo | null {
  if (!data || !tagged) return null
  const field = data.fields?.[tagged.recordRef]?.[tagged.fieldKey]
  return field && typeof field.type === 'string' ? field : null
}

/** The record a thread about `element` belongs to, or null when the page names none. */
export function recordFor(element: Element, index: TagIndex): string | null {
  const tagged = index.closest(element)
  if (tagged) return tagged.recordRef
  const entry = element.closest('[data-zap-entry]')?.getAttribute('data-zap-entry')?.trim()
  if (entry && isRecordRef(entry)) return entry
  const counts = new Map<string, number>()
  for (const row of index.summary()) {
    counts.set(row.recordRef, (counts.get(row.recordRef) ?? 0) + row.count)
  }
  let best: string | null = null
  let most = 0
  for (const [ref, count] of counts) {
    if (count > most) {
      best = ref
      most = count
    }
  }
  return best
}

/** The page's address for anchors and the `on-page` read: no hash, at most 2048 chars. */
export function currentPageUrl(win: Window): string {
  const { origin, pathname, search } = win.location
  return `${origin}${pathname}${search}`.slice(0, 2048)
}

const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)
const whole = (value: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(1, Math.round(value))) : 1

type ElementAnchor = Extract<ApiAnchor, { dom: unknown }>

/** A page anchor as the public API takes it: keys, not ids; null layers left out. */
export function toApiAnchor(anchor: PageAnchor, recordRef: string): ElementAnchor {
  const dom = anchor.dom
  const out: ElementAnchor = {
    dom: {
      ...(dom.tag && dom.tag.length <= 500 ? { tag: dom.tag } : {}),
      ...(dom.selector ? { selector: dom.selector } : {}),
      ...(dom.textQuote
        ? {
            textQuote: {
              exact: dom.textQuote.exact.slice(0, 500),
              prefix: dom.textQuote.prefix.slice(-32),
              suffix: dom.textQuote.suffix.slice(0, 32),
            },
          }
        : {}),
      rect: { x: unit(dom.rect.x), y: unit(dom.rect.y), w: unit(dom.rect.w), h: unit(dom.rect.h) },
      viewport: { w: whole(dom.viewport.w, 100_000), h: whole(dom.viewport.h, 1_000_000) },
    },
  }
  if (anchor.field && anchor.field.recordRef === recordRef) {
    out.field = {
      key: anchor.field.key,
      ...(anchor.field.locale ? { locale: anchor.field.locale } : {}),
    }
  }
  return out
}

export function recordKeys(
  recordRef: string,
): Pick<CreateBody, 'collection' | 'slug' | 'document'> {
  const parsed = parseRecordRef(recordRef)
  if (!parsed) return {}
  return parsed.kind === 'document'
    ? { document: parsed.key }
    : { collection: parsed.collection, slug: parsed.slug }
}

export interface Proposal {
  fieldKey: string
  locale: string | null
  value: string | number
}

/**
 * The «Comentar» body. A proposal goes only with a change request; the
 * comment (trimmed) is the body, or the proposed value's text when there is
 * no comment.
 */
export function buildCreateBody(input: {
  recordRef: string
  pageUrl: string
  anchors: ApiAnchor[]
  comment: string
  isChangeRequest: boolean
  proposal: Proposal | null
}): CreateBody {
  const proposal = input.isChangeRequest ? input.proposal : null
  const comment = input.comment.trim()
  const body: CreateBody = {
    ...recordKeys(input.recordRef),
    isChangeRequest: input.isChangeRequest,
    pageUrl: input.pageUrl,
    anchors: input.anchors.slice(0, 20),
    body: (comment || (proposal ? String(proposal.value) : '')).slice(0, 10_000),
  }
  if (proposal) Object.assign(body, proposedPart(proposal))
  return body
}

/** The «Editar» body: the new value, saved to the record's draft. */
export function buildDraftBody(input: {
  recordRef: string
  pageUrl: string
  anchors: ApiAnchor[]
  proposal: Proposal
}): DraftBody {
  return {
    ...recordKeys(input.recordRef),
    pageUrl: input.pageUrl,
    anchors: input.anchors.slice(0, 20),
    body: String(input.proposal.value).slice(0, 10_000) || ' ',
    ...proposedPart(input.proposal),
  }
}

function proposedPart(proposal: Proposal): Pick<CreateBody, 'locale' | 'proposedValues'> {
  const locale = proposal.locale
  return {
    ...(locale ? { locale } : {}),
    proposedValues: [
      { fieldKey: proposal.fieldKey, ...(locale ? { locale } : {}), value: proposal.value },
    ],
  }
}

/**
 * Two parsed values are the same edit: numbers by value, text without stega
 * markers and with whitespace collapsed (`normalizeText`), so a field left
 * as it was, read back from a preview page, never counts as a change.
 */
export function sameValue(a: string | number, b: string | number): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b
  return normalizeText(a) === normalizeText(b)
}

const LINE_BLOCKS = new Set(['div', 'p', 'li'])

/**
 * The text an inline edit left in `element`, as typed: its text nodes, `<br>`
 * and a new block (what Enter makes in a contenteditable) as line breaks.
 * Never `innerText`: it applies CSS, so a field shown with `text-transform:
 * uppercase` read back in capitals and every edit of it looked like a change.
 */
export function editableText(element: Element): string {
  let out = ''
  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        out += (child as Text).data
      } else if (child.nodeType === 1) {
        const name = (child as Element).localName
        if (name === 'br') {
          out += '\n'
          continue
        }
        if (LINE_BLOCKS.has(name) && out !== '' && !out.endsWith('\n')) out += '\n'
        walk(child)
      }
    }
  }
  walk(element)
  return out
}

/** The value typed for `kind`, parsed for its field type; `invalid` when a number is not one. */
export function parseProposed(
  type: string,
  raw: string,
): { ok: true; value: string | number } | { ok: false } {
  // Text read from the page in preview carries stega markers; never send one.
  raw = cleanStega(raw)
  if (type === 'NUMBER') {
    const text = raw.trim().replace(',', '.')
    const value = Number(text)
    return text !== '' && Number.isFinite(value) ? { ok: true, value } : { ok: false }
  }
  if (type === 'TEXT' || type === 'URL') return { ok: true, value: normalizeText(raw) }
  return { ok: true, value: raw.replace(/\r\n?/g, '\n').trim() }
}

/** A point of the page, from a click at viewport `(x, y)`, as fractions of the whole document. */
export function spotAnchor(x: number, y: number, doc: Document, win: Window): ApiAnchor {
  const root = doc.documentElement
  const w = Math.max(root.scrollWidth, 1)
  const h = Math.max(root.scrollHeight, 1)
  return {
    spot: { x: unit((x + win.scrollX) / w), y: unit((y + win.scrollY) / h) },
    viewport: { w: whole(w, 100_000), h: whole(h, 1_000_000) },
  }
}

/** An anchor the page can show: a point, or an element (the editor's `onPageAnchor`). */
function onPage(anchor: OnPageAnchor): boolean {
  return !!(anchor?.spot || anchor?.rect || anchor?.tag || anchor?.selector)
}

/**
 * The numbered pins of the page's open threads. Numbers go to every thread
 * with an on-page anchor, oldest first, so «2» here is «2» in Zap; a pin is
 * drawn at the thread's point, else at the first of its elements still on the
 * page (a thread whose element is gone keeps its number and draws nothing).
 * Never throws: stored selectors only reach `safeQueryAll`.
 */
export function pinsFor<R extends { id: string; createdAt: string; anchors: OnPageAnchor[] }>(
  threads: readonly R[],
  index: TagIndex,
  doc: Document,
  win: Window,
): { pins: OverlayPin[]; numbers: Map<string, number> } {
  const numbers = new Map<string, number>()
  const pins: OverlayPin[] = []
  const numbered = threads
    .filter((thread) => Array.isArray(thread.anchors) && thread.anchors.some(onPage))
    .sort(
      (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id),
    )
  numbered.forEach((thread, i) => {
    const n = i + 1
    numbers.set(thread.id, n)
    const spot = thread.anchors.find((anchor) => anchor?.spot)?.spot
    if (spot && Number.isFinite(spot.x) && Number.isFinite(spot.y)) {
      pins.push({ id: thread.id, n, spot: { x: unit(spot.x), y: unit(spot.y) } })
      return
    }
    for (const anchor of thread.anchors) {
      if (!onPage(anchor) || anchor.spot) continue
      const element = findAnchorElement(asDomAnchor(anchor), index, doc, win)
      if (element && element !== doc.body && element !== doc.documentElement) {
        pins.push({ id: thread.id, n, element })
        return
      }
    }
  })
  return { pins: pins.slice(0, 50), numbers }
}

/** No rectangle fallback: a pin on a guessed element is worse than none. */
const NOWHERE = { x: -1, y: -1, w: 0, h: 0 }

function asDomAnchor(anchor: OnPageAnchor): DomAnchor {
  const tag = typeof anchor?.tag === 'string' && anchor.tag.length <= 500 ? anchor.tag : null
  const selector =
    typeof anchor?.selector === 'string' && anchor.selector.length <= 1024 ? anchor.selector : null
  return { tag, selector, textQuote: null, rect: NOWHERE, viewport: { w: 1, h: 1 } }
}
