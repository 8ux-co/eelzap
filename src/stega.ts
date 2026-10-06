/**
 * Stega: invisible field markers on prose values read in preview
 * (`.docs/proposals/zap-cms-v2.md` §2.4, §7.5).
 *
 * Zap appends a marker to TEXT and LONG_TEXT values, and to the last text
 * node of each RICH_TEXT block, ONLY in `preview=1` delivery responses. The
 * preview overlay finds the marker in the page's text nodes and so knows
 * which element renders which field, with no manual tag. Published responses
 * never carry one.
 *
 * ## Format (eelzap stega v1)
 *
 * A marker is the tag the overlay would read from a `data-zap` attribute,
 * `recordRef#fieldKey`, plus `@locale` when the value belongs to a locale:
 *
 *     blog-posts/mi-primer-post#title@es
 *     doc:home#hero_title@es
 *
 * written as zero-width characters:
 *
 * - four digits, base 4: U+200B (0), U+200C (1), U+200D (2), U+2060 (3);
 * - a prefix of 8 digits, the bytes 0xE5 0xA7 (`3211 2213`);
 * - then every byte of the ASCII payload as 4 digits, most significant first.
 *
 * The payload is printable ASCII (the tag grammar allows nothing else), so
 * every payload byte starts with digit 0 or 1 and the prefix, which starts
 * with 3, can never be read inside a payload. A decoder reads groups of four
 * after the prefix until a group is not a payload byte, then validates the
 * result against the tag grammar; anything that does not parse is ignored. A
 * value never carries two markers (`stegaEncode` refuses to add a second).
 *
 * Why not `@vercel/stega`'s format: it encodes a JSON object (a URL and
 * origin in Sanity's and Vercel's use) and uses U+FEFF, which some tools strip
 * as a byte order mark. Here the decoded marker IS the tag grammar
 * (`data-zap`), so one parser serves both, and U+FEFF is avoided. No
 * dependency either way.
 *
 * Zero dependencies, no side effects: `.` re-exports `cleanStega` and
 * `hasStega`; the encoder is internal (Zap's delivery imports it); the
 * decoder serves `./preview`.
 */

const DIGITS = ['​', '‌', '‍', '⁠'] as const
const PREFIX = '⁠‍‌‌‍‍‌⁠'
/** Longest payload a marker may carry, in bytes (ref 300 + field 128 + locale). */
const MAX_PAYLOAD = 512

/** `recordRef#fieldKey` with an optional `@locale`: the tag grammar (`refs.ts`). */
const PAYLOAD_RE =
  /^(doc:[a-z0-9]+(?:-[a-z0-9]+)*|[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*)#([a-z][a-z0-9_]{0,127})(?:@([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}))?$/
/** The prefix, then whole payload bytes (first digit 0 or 1). */
const MARKER_RE = /⁠‍‌‌‍‍‌⁠(?:[​‌][​‌‍⁠]{3})*/g

/** What one marker says: the record, the field, and the locale when known. */
export interface StegaInfo {
  /** `collectionKey/slug` or `doc:documentKey`. */
  recordRef: string
  fieldKey: string
  locale?: string | null
}

export interface DecodedStega {
  recordRef: string
  fieldKey: string
  locale: string | null
  /** `recordRef#fieldKey`, the `data-zap` tag. */
  tag: string
}

/** The marker for one field, or `''` when the info does not fit the tag grammar. */
export function stegaMarker(info: StegaInfo): string {
  const payload = `${info.recordRef}#${info.fieldKey}${info.locale ? `@${info.locale}` : ''}`
  if (payload.length > MAX_PAYLOAD || !PAYLOAD_RE.test(payload)) return ''
  let out = PREFIX
  for (let i = 0; i < payload.length; i++) {
    const byte = payload.charCodeAt(i)
    out +=
      DIGITS[(byte >> 6) & 3]! +
      DIGITS[(byte >> 4) & 3]! +
      DIGITS[(byte >> 2) & 3]! +
      DIGITS[byte & 3]!
  }
  return out
}

/**
 * `text` with the field's marker appended. A string that already carries a
 * marker, or info outside the grammar, comes back unchanged.
 */
export function stegaEncode(text: string, info: StegaInfo): string {
  if (hasStega(text)) return text
  return text + stegaMarker(info)
}

/** True when `value` is a string carrying at least one marker. */
export function hasStega(value: unknown): boolean {
  return typeof value === 'string' && value.includes(PREFIX)
}

/** Every valid marker in `text`, in order. Invalid ones are skipped. */
export function stegaDecode(text: string): DecodedStega[] {
  if (!text.includes(PREFIX)) return []
  const found: DecodedStega[] = []
  for (const match of text.match(MARKER_RE) ?? []) {
    let payload = ''
    for (let i = PREFIX.length; i + 4 <= match.length; i += 4) {
      let byte = 0
      for (let j = 0; j < 4; j++) byte = byte * 4 + DIGITS.indexOf(match[i + j] as never)
      payload += String.fromCharCode(byte)
    }
    const parsed = PAYLOAD_RE.exec(payload)
    if (!parsed) continue
    found.push({
      recordRef: parsed[1]!,
      fieldKey: parsed[2]!,
      locale: parsed[3] ?? null,
      tag: `${parsed[1]}#${parsed[2]}`,
    })
  }
  return found
}

/** `text` split into its visible part and the markers it carries, in order. */
export function splitStega(text: string): { text: string; markers: string } {
  if (!text.includes(PREFIX)) return { text, markers: '' }
  return { text: text.replace(MARKER_RE, ''), markers: (text.match(MARKER_RE) ?? []).join('') }
}

/** `text` without any marker. */
function cleanString(text: string): string {
  return text.includes(PREFIX) ? text.replace(MARKER_RE, '') : text
}

/**
 * `value` with every stega marker removed: a string is cleaned, an array or a
 * plain object is cleaned deeply (into new objects), anything else is
 * returned as is. Use it where a preview value is compared, parsed or put in
 * an attribute, a URL or `<head>`; outside preview it changes nothing.
 */
export function cleanStega<T>(value: T): T {
  if (typeof value === 'string') return cleanString(value) as T
  if (Array.isArray(value)) return value.map((item) => cleanStega(item)) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = cleanStega(item)
    return out as T
  }
  return value
}
