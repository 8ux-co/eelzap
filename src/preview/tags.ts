import { hasStega, stegaDecode } from '../stega'
import {
  isLocale,
  parseRecordRef,
  parseTag,
  type RecordRef,
  type TagSource,
  type TagSummary,
} from './protocol'

/**
 * The tag grammar and the tag index (`.docs/proposals/zap-cms-v2.md` §2.4).
 *
 * ```html
 * <h1 data-zap="blog-posts/mi-primer-post#title">…</h1>
 * <p data-zap="doc:home#hero_subtitle">…</p>
 * <article data-zap-entry="blog-posts/mi-primer-post">
 *   <h1 data-zap-field="title">…</h1>
 *   <div data-zap-field="body" data-zap-html>…</div>
 * </article>
 * ```
 *
 * - `collectionKey/slug` for entries (default-locale or localized slug; the
 *   EDITOR resolves which record that is — the page only reports strings),
 *   `doc:documentKey` for documents, `#fieldKey` for the field. Keys, slugs
 *   and field keys follow Zap's own patterns (lowercase, hyphens; field keys
 *   `[a-z][a-z0-9_]*`), so a tag that could never match a record is reported
 *   as invalid instead of silently never lighting up.
 * - `data-zap` wins over `data-zap-field` on the same element.
 * - `data-zap-field` takes its record from the nearest `data-zap-entry`
 *   ancestor (or the element itself).
 * - `data-zap-locale` on the element or any ancestor pins the locale; a value
 *   for another locale is not substituted there.
 * - `data-zap-html` opts the element into sanitised innerHTML substitution.
 *
 * ## Stega (§2.4)
 *
 * Text fields read in preview carry an invisible marker (`../stega.ts`). The
 * scan also walks the page's text nodes, decodes every marker and indexes the
 * text node's parent element under that field, with `source: 'stega'`. A
 * manual tag on the same element wins: the element keeps its attribute tag
 * and the marker is ignored for it. Text in `<head>`, `<script>`, `<style>`,
 * `<template>` and `<noscript>` is never indexed.
 */

export { parseRecordRef, parseTag }

export const TAG_SELECTOR = '[data-zap],[data-zap-field]'

export interface TaggedElement {
  element: Element
  recordRef: RecordRef
  fieldKey: string
  /** Canonical `recordRef#fieldKey`. */
  tag: string
  locale: string | null
  html: boolean
  /** `attr` for a manual tag, `stega` for a marker found in a text node. */
  source: TagSource
  /** Stega only: the text node that carries the marker (values are written to it). */
  textNode?: Text
}

export interface TagProblem {
  attribute: 'data-zap' | 'data-zap-field' | 'data-zap-entry'
  value: string
}

export type ReadTagResult =
  | { ok: true; tagged: TaggedElement }
  | { ok: false; problem: TagProblem }
  | null

/** Read one element's tag. `null` when it carries no tag attribute. */
export function readElementTag(element: Element): ReadTagResult {
  const locale = readLocale(element)
  const html = element.hasAttribute('data-zap-html')

  const direct = element.getAttribute('data-zap')
  if (direct !== null) {
    const parsed = parseTag(direct)
    if (!parsed) return { ok: false, problem: { attribute: 'data-zap', value: clip(direct) } }
    return { ok: true, tagged: build(element, parsed.recordRef, parsed.fieldKey, locale, html) }
  }

  const field = element.getAttribute('data-zap-field')
  if (field === null) return null
  const fieldKey = field.trim()
  if (!parseTag(`doc:x#${fieldKey}`)) {
    return { ok: false, problem: { attribute: 'data-zap-field', value: clip(field) } }
  }
  const container = element.closest('[data-zap-entry]')
  const entry = container?.getAttribute('data-zap-entry')?.trim()
  if (!entry || !parseRecordRef(entry)) {
    return { ok: false, problem: { attribute: 'data-zap-entry', value: clip(entry ?? '') } }
  }
  return { ok: true, tagged: build(element, entry, fieldKey, locale, html) }
}

function build(
  element: Element,
  recordRef: string,
  fieldKey: string,
  locale: string | null,
  html: boolean,
): TaggedElement {
  return {
    element,
    recordRef,
    fieldKey,
    tag: `${recordRef}#${fieldKey}`,
    locale,
    html,
    source: 'attr',
  }
}

/** Elements whose text is never a rendered field. */
const NON_RENDERED = /^(?:head|title|script|style|template|noscript|textarea)$/

function readLocale(element: Element): string | null {
  const value = element.closest('[data-zap-locale]')?.getAttribute('data-zap-locale')?.trim()
  return value && isLocale(value) ? value : null
}

function clip(value: string): string {
  return value.length > 200 ? value.slice(0, 200) : value
}

/**
 * Every tagged element in a document, in document order, with lookups by
 * field and by element. Rebuilt wholesale by `scan()`: a full scan of a large
 * page is one `querySelectorAll`, cheaper and far simpler than patching the
 * index per mutation record.
 */
export class TagIndex {
  private list: TaggedElement[] = []
  private byElement = new WeakMap<Element, TaggedElement>()
  private byTag = new Map<string, TaggedElement[]>()
  problems: TagProblem[] = []

  constructor(private readonly root: ParentNode) {}

  scan(): void {
    const list: TaggedElement[] = []
    const problems: TagProblem[] = []
    const byElement = new WeakMap<Element, TaggedElement>()
    const byTag = new Map<string, TaggedElement[]>()
    const add = (element: Element, tagged: TaggedElement) => {
      list.push(tagged)
      if (!byElement.has(element)) byElement.set(element, tagged)
      const bucket = byTag.get(tagged.tag)
      if (bucket) bucket.push(tagged)
      else byTag.set(tagged.tag, [tagged])
    }
    for (const element of Array.from(this.root.querySelectorAll(TAG_SELECTOR))) {
      const result = readElementTag(element)
      if (!result) continue
      if (!result.ok) {
        problems.push(result.problem)
        continue
      }
      add(element, result.tagged)
    }
    const doc = (this.root as Node).ownerDocument ?? (this.root as Document)
    const walker = doc.createTreeWalker(this.root as Node, 4 /* NodeFilter.SHOW_TEXT */)
    for (let node: Node | null; (node = walker.nextNode()); ) {
      const text = node as Text
      const element = text.parentElement
      if (!element || !hasStega(text.data)) continue
      // Never a rendered field; and a manual tag on the element wins over its markers.
      if (NON_RENDERED.test(element.localName) || element.closest('head')) continue
      if (byElement.get(element)?.source === 'attr') continue
      for (const found of stegaDecode(text.data)) {
        add(element, {
          element,
          recordRef: found.recordRef,
          fieldKey: found.fieldKey,
          tag: found.tag,
          locale: found.locale ?? readLocale(element),
          html: false,
          source: 'stega',
          textNode: text,
        })
      }
    }
    // Document order across both kinds (same element: insertion order).
    list.sort((a, b) =>
      a.element.compareDocumentPosition(b.element) & 4 /* FOLLOWING */
        ? -1
        : a.element === b.element
          ? 0
          : 1,
    )
    this.list = list
    this.byElement = byElement
    this.byTag = byTag
    this.problems = problems
  }

  get elements(): readonly TaggedElement[] {
    return this.list
  }

  byField(recordRef: RecordRef, fieldKey: string): TaggedElement[] {
    return this.byTag.get(`${recordRef}#${fieldKey}`) ?? []
  }

  get(element: Element): TaggedElement | null {
    return this.byElement.get(element) ?? null
  }

  /** The nearest tagged element at or above `target`. */
  closest(target: Element | null): TaggedElement | null {
    for (let node: Element | null = target; node; node = node.parentElement) {
      const tagged = this.byElement.get(node)
      if (tagged) return tagged
    }
    return null
  }

  /** The `zap:tags` report: one row per tag with its element count, sorted. */
  summary(): TagSummary[] {
    return Array.from(this.byTag.entries())
      .map(([tag, items]) => ({
        tag,
        recordRef: items[0]!.recordRef,
        fieldKey: items[0]!.fieldKey,
        count: items.length,
        source: items.some((item) => item.source === 'attr')
          ? ('attr' as const)
          : ('stega' as const),
      }))
      .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
  }
}

export interface ObserveOptions {
  /** Minimum gap between two callbacks. Default 250 ms. */
  throttleMs?: number
  /** Mutations entirely inside these nodes are ignored (the overlay's host). */
  ignore?: (node: Node) => boolean
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

/**
 * Call `onChange` after DOM mutations, throttled (leading call deferred,
 * trailing call guaranteed): a hydrating site or an infinite list can fire
 * thousands of records a second, and the index needs one rescan per burst.
 * Mutations made by the overlay's own host are ignored, so drawing outlines
 * never triggers a rescan.
 */
export function observeTags(
  target: Node,
  onChange: () => void,
  options: ObserveOptions = {},
): () => void {
  const throttleMs = options.throttleMs ?? 250
  const set = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clear = options.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const view = (target.ownerDocument ?? (target as Document)).defaultView
  const Observer = view?.MutationObserver ?? globalThis.MutationObserver
  if (!Observer) return () => {}

  let timer: unknown = null
  let last = -Infinity
  const fire = () => {
    timer = null
    last = Date.now()
    onChange()
  }
  const observer = new Observer((records) => {
    if (options.ignore && records.every((record) => options.ignore!(record.target))) return
    if (timer !== null) return
    const wait = Math.max(0, last + throttleMs - Date.now())
    timer = set(fire, Math.max(wait, 16))
  })
  observer.observe(target, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-zap', 'data-zap-field', 'data-zap-entry', 'data-zap-locale'],
    characterData: true,
  })
  return () => {
    observer.disconnect()
    if (timer !== null) clear(timer)
  }
}
