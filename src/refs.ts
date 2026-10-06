/**
 * The record and field grammar of tags (`.docs/proposals/zap-cms-v2.md` §2.4),
 * in a module of its own so the light entries (`./fields`, `./react`, the
 * boot) can name records without pulling in the preview protocol.
 * No imports, no side effects.
 */

/**
 * A record reference in its canonical string form: `collectionKey/slug` for an
 * entry, `doc:documentKey` for a document (the tag grammar, §2.4).
 */
export type RecordRef = string

/** Zap's field key pattern. */
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,127}$/
/** Entry and document references; keys and slugs are `[a-z0-9]+(?:-[a-z0-9]+)*`. */
const ENTRY_REF_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/
const DOC_REF_RE = /^doc:([a-z0-9]+(?:-[a-z0-9]+)*)$/
const MAX_REF_LENGTH = 300

export type ParsedRecordRef =
  | { kind: 'entry'; collection: string; slug: string }
  | { kind: 'document'; key: string }

export function parseRecordRef(value: unknown): ParsedRecordRef | null {
  if (typeof value !== 'string' || value.length > MAX_REF_LENGTH) return null
  const doc = DOC_REF_RE.exec(value)
  if (doc) return { kind: 'document', key: doc[1]! }
  const entry = ENTRY_REF_RE.exec(value)
  if (entry) return { kind: 'entry', collection: entry[1]!, slug: entry[2]! }
  return null
}

export function isRecordRef(value: unknown): value is RecordRef {
  return parseRecordRef(value) !== null
}

/** `zpt_` + 32 bytes in base64url, as Zap mints it (zap-cms-v2 §3.5). */
export const PREVIEW_TOKEN_RE = /^zpt_[A-Za-z0-9_-]{43}$/

/** A preview token in the shape Zap mints; says nothing about whether it is live. */
export function isPreviewTokenShape(value: unknown): value is string {
  return typeof value === 'string' && PREVIEW_TOKEN_RE.test(value)
}

export function isFieldKey(value: unknown): value is string {
  return typeof value === 'string' && FIELD_KEY_RE.test(value)
}

/**
 * What `zapAttrs` and `onValues` accept: a record reference string
 * (`blog/hola`, `doc:home`) or a delivery API entry (an item carries
 * `collection.key` and `slug`, a document `key`).
 */
export type EntryLike =
  | RecordRef
  | {
      slug?: string | null
      key?: string | null
      collection?: { key?: string | null } | null
      localizedSlugs?: Record<string, string | null | undefined> | null
    }

/** Every reference an entry answers to (default slug first, then localized ones). */
export function recordRefsOf(entry: EntryLike | null | undefined): RecordRef[] {
  if (!entry) return []
  if (typeof entry === 'string') return isRecordRef(entry) ? [entry] : []
  const refs: RecordRef[] = []
  const add = (ref: string) => {
    if (isRecordRef(ref) && !refs.includes(ref)) refs.push(ref)
  }
  const collection = entry.collection?.key
  if (collection) {
    if (entry.slug) add(`${collection}/${entry.slug}`)
    for (const slug of Object.values(entry.localizedSlugs ?? {})) {
      if (slug) add(`${collection}/${slug}`)
    }
  } else if (entry.key) {
    add(`doc:${entry.key}`)
  }
  return refs
}

/**
 * The tag for one field, as attributes to spread on the element that renders
 * it: `{ 'data-zap': 'blog/hola#title' }`. Empty when the entry or the field
 * key is not one Zap can name, so a bad call never breaks the page.
 */
export function zapAttrs(entry: EntryLike, fieldKey: string): { 'data-zap'?: string } {
  const [ref] = recordRefsOf(entry)
  if (!ref || !isFieldKey(fieldKey)) return {}
  return { 'data-zap': `${ref}#${fieldKey}` }
}
