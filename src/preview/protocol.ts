import { isFieldKey, isPreviewTokenShape, isRecordRef, type RecordRef } from '../refs'

/**
 * The bridge protocol, version 1 (`.docs/proposals/zap-cms-v2.md` §2.6).
 *
 * The editor frames the customer's own site by its real URL, and the site's
 * Zap client (`live.ts`) answers. Every message is the envelope `{ source: 'eel-zap', v: 1, session, type, payload }`;
 * anything else is ignored.
 *
 * ## Hand-written validators, not zod
 *
 * The spec asks for "a zod schema on both sides". The browser core has a
 * 12 KB gzip budget and zero dependencies (§2.7, §7.4), and zod alone is
 * several times that, so every payload is checked here by small explicit
 * predicates instead. The EDITOR side imports these same validators
 * (`./editor`), so the two ends cannot disagree about what a valid message
 * is — one source of truth instead of a zod copy that drifts.
 *
 * Every validator is strict: wrong types, unknown enum values, strings over
 * their cap and arrays over their cap fail the WHOLE message (it is dropped
 * and counted), never coerced. Extra keys are ignored.
 *
 * ## Additions to the §2.6 table
 *
 * - `zap:zoom` (editor → page) `{ zoom }`: the panel's scale changes when the
 *   panel is resized or the device switches, and the overlay divides its 2px
 *   outline and 12px chip by it (ui-patterns/preview-panel.md rule 5). The page
 *   cannot read its parent's CSS transform, so the editor tells it.
 * - `zap:highlight` (editor → page) `{ anchors }`: selecting a change request
 *   highlights its anchors in the preview (§3.3 "Where they show"). The
 *   anchors' selectors come from stored, user-influenced rows, so the overlay
 *   re-finds them defensively (`findAnchorElement`).
 * - `zap:hello` also carries an optional `zoom` so the first paint is right.
 * - `zap:hello` carries an optional `previewToken` in Live mode (P7): the
 *   `zpt_` token the editor minted for the draft-mode URL, so the client can
 *   keep it in `sessionStorage` for the cookieless fallback (§2.5 "Cookies in
 *   the frame"). The editor sends it only to the exact page origin that
 *   answered `zap:ready` from the site's preview origins, the same site the
 *   draft-mode URL already handed it to.
 * - Comments (§3.3 "Anchors", spot pins), only to a page whose `zap:ready`
 *   advertised the `pins` capability (older CDN clients never see them):
 *   mode `spot` (a click anywhere becomes `zap:spot` with the point as
 *   fractions of the whole document), `zap:pins` (editor → page, the numbered
 *   pins to draw, ≤ 50) and `zap:pin` (page → editor, a pin was clicked).
 * - Links, only to a page whose `zap:ready` advertised the `links` capability:
 *   a URL field's value is `{ url }` and an EMAIL field's `{ email }`, so the
 *   page writes a link's `href` (`mailto:` for an email) and leaves its label
 *   alone (`values.ts`). Older clients get the bare string, as before.
 * - `zap:paused` (page → editor) `{ reason, count }`: the runaway guard
 *   (`tagGuard` in `tags.ts`) stopped following the page: `cap` past 5,000
 *   tagged elements, `runaway` when the count kept growing with nothing on
 *   the page explaining it. The page stops writing values; the editor offers
 *   a reload. Sent again after a hello, which a pause before it never reached.
 * - Comparar (#953), two frames of one page side by side, the published one
 *   and the draft. Scroll sync, only to a page whose `zap:ready` advertised
 *   `scroll-sync`: `zap:scroll-sync` (editor → page) `{ enabled }` starts or
 *   stops `zap:scroll` (page → editor) `{ y, x?, anchor? }`, one per animation
 *   frame at most, positions as fractions (0..1) of the scrollable range and
 *   `anchor` the tagged field nearest the viewport's top; `zap:scroll-to`
 *   (editor → page, same shape) places the page there, by the anchor when
 *   the page has that field, else by the fraction, and is never echoed back.
 *   Diff marks, only to a page whose `zap:ready` advertised `diff-marks`:
 *   `zap:marks` (editor → page) `{ marks }`, every element of each field
 *   marked in its tone, removed (published) or added (draft); ≤ 200 marks,
 *   an empty list clears them.
 */

export const PROTOCOL_SOURCE = 'eel-zap'
/**
 * `zap:error` code the page sends from `pagehide`: this document is going away
 * (a link, a refresh, a site script setting `location`). The editor holds
 * everything it would post until the next document says `zap:ready`, and
 * answers that one with the hello again.
 */
export const PAGE_UNLOAD_ERROR = 'PAGE_UNLOAD'
export const PROTOCOL_VERSION = 1
/** Hard cap per message, in UTF-8 bytes of its JSON form (§2.6, §7.4). */
export const MAX_MESSAGE_BYTES = 256 * 1024
/** §3.3 limits. */
export const MAX_ANCHORS = 20
export const MAX_QUOTE_EXACT = 500
export const MAX_QUOTE_CONTEXT = 32
export const MAX_SELECTOR_BYTES = 1024
export const MAX_URL_LENGTH = 2048
/** Bounds on report sizes so a hostile or huge page cannot flood the editor. */
export const MAX_TAG_REPORT = 2000
export const MAX_LABELS = 500
/** Pins drawn at once (`zap:pins`). */
export const MAX_PINS = 50
/** Diff marks drawn at once (`zap:marks`), and the longest mark label. */
export const MAX_MARKS = 200
export const MAX_MARK_LABEL = 200
/** Highest occurrence index a scroll anchor may name (`MAX_TAGGED` in `tags.ts`). */
export const MAX_ANCHOR_NTH = 5000

export type OverlayMode = 'inspect' | 'select' | 'spot' | 'off'
export const OVERLAY_MODES: readonly OverlayMode[] = ['inspect', 'select', 'spot', 'off']

export type Capability =
  | 'overlay'
  | 'values'
  | 'stega'
  | 'pins'
  | 'links'
  | 'refresh'
  | 'scroll-sync'
  | 'diff-marks'
  | 'fragment-token'
/** Every capability; a client built from this source advertises all of them. */
/** The most capabilities a ready may list, known or not. */
const MAX_CAPABILITIES = 32

export const CAPABILITIES: readonly Capability[] = [
  'overlay',
  'values',
  'stega',
  'pins',
  'links',
  'refresh',
  'scroll-sync',
  'diff-marks',
  'fragment-token',
]

export {
  FIELD_KEY_RE,
  isFieldKey,
  isPreviewTokenShape,
  PREVIEW_TOKEN_RE,
  isRecordRef,
  parseRecordRef,
  type ParsedRecordRef,
  type RecordRef,
} from '../refs'

/**
 * A value the editor sends for one field, ALREADY formatted for display.
 *
 * The browser core never formats: the editor owns the suite's formatters
 * (dates, numbers, enum labels; CLAUDE.md "Money/dates/plurals go through
 * shared formatters"), knows each field's type, and sends the text the page
 * should show. A bare string, number or boolean is shorthand for `{ text }`.
 * `{ url }` and `{ email }` (a URL and an EMAIL field, `links` capability) go
 * to a link's `href` rather than its text.
 */
export type PreviewValue =
  | string
  | number
  | boolean
  | null
  | { text: string }
  | { html: string }
  | { url: string }
  | { email: string }
  | { image: { src?: string | null; srcset?: string | null; alt?: string | null } }

/** Longest EMAIL value accepted (RFC 5321's path limit). */
export const MAX_EMAIL_LENGTH = 320

/** How the page found an element: a stega marker in its text, or a `data-zap` attribute. */
export type TagSource = 'stega' | 'attr'

export interface TagSummary {
  /** The canonical tag, `recordRef#fieldKey`. */
  tag: string
  recordRef: RecordRef
  fieldKey: string
  count: number
  /**
   * `attr` when at least one element carries a manual tag (a manual tag wins),
   * else `stega`. Optional on the wire: clients released before stega omit it.
   */
  source?: TagSource
}

export interface TextQuote {
  exact: string
  prefix: string
  suffix: string
}

export interface NormalizedRect {
  x: number
  y: number
  w: number
  h: number
}

/** The `dom` layer of an anchor (§3.3), captured by the overlay. */
export interface DomAnchor {
  tag: string | null
  selector: string | null
  textQuote: TextQuote | null
  rect: NormalizedRect
  viewport: { w: number; h: number }
}

/**
 * An anchor as the PAGE reports it. The editor adds the field's `id` (the page
 * knows keys, never ids) before storing it as a change-request anchor.
 */
export interface PageAnchor {
  field: { recordRef: RecordRef; key: string; locale: string | null } | null
  dom: DomAnchor
  pageUrl: string
}

export interface ReadyPayload {
  version: string
  capabilities: Capability[]
  pageUrl: string
  /**
   * The site's draft-mode route as a PATH (`/api/zap-preview`), or null when
   * the site has none (§2.5, §7.5). Never an origin: the editor joins it to
   * the frame's verified origin (`draftModeUrl` in `./editor`), so a hostile
   * page cannot send a preview token to another host. Optional on the wire:
   * older clients omit it, which reads as null.
   */
  draftRoute?: string | null
}

export interface HelloPayload {
  session: string
  siteKey: string
  locale: string
  labels: Record<string, string>
  recordRef: RecordRef
  mode: OverlayMode
  theme?: OverlayTheme
  zoom?: number
  /** Live only: the draft-mode token for the cookieless fallback. */
  previewToken?: string
  /**
   * Fields on the page that belong to ANOTHER record than `recordRef` (a
   * site-wide document in the header, a related entry): the full tag
   * (`TagSummary.tag`, `recordRef#fieldKey`) to `[label, suffix]`, the suffix
   * already localized («en Configuración»). The chip draws the label, then
   * the suffix muted. At most `MAX_LABELS`; optional, older clients ignore it.
   */
  foreign?: Record<string, [label: string, suffix: string]>
}

/** Colours the editor may override; `#rgb` / `#rrggbb` only. */
export interface OverlayTheme {
  outline?: string
  chip?: string
  chipText?: string
}

export interface ValuesPayload {
  recordRef: RecordRef
  locale: string
  patch: Record<string, PreviewValue>
}

export interface FieldRefPayload {
  recordRef: RecordRef
  fieldKey: string
}

/**
 * `zap:click`: the field, and optionally the clicked element's box in the
 * frame's viewport, CSS px before the editor's zoom (older clients omit it).
 */
export interface ClickPayload extends FieldRefPayload {
  rect?: { x: number; y: number; w: number; h: number }
}

/** A point as fractions (0..1) of the whole document, not the viewport (§3.3). */
export interface SpotPoint {
  x: number
  y: number
}

/** A spot anchor (§3.3): the point, and the document's scroll size when it was taken. */
export interface SpotAnchor {
  spot: SpotPoint
  viewport: { w: number; h: number }
}

/** `zap:spot`: the user clicked the page in `spot` mode. */
export interface SpotPayload extends SpotAnchor {
  pageUrl: string
}

/**
 * A numbered comment pin (`zap:pins`). Exactly one of `spot` (a point of the
 * document) or `dom` (an element, re-found like a highlight). `n` is the
 * number drawn on it.
 */
export type Pin = { id: string; n: number } & (
  | { spot: SpotPoint; dom?: undefined }
  | { dom: DomAnchor; spot?: undefined }
)

/** `zap:paused`: why the page stopped following itself, and the tagged count then. */
export interface PausedPayload {
  reason: 'runaway' | 'cap'
  count: number
}

/**
 * A tagged field's element as a scroll anchor: the `nth` element of the field
 * (in `TagIndex.byField` order, 0 first) and its top's distance below the
 * viewport's top, CSS px (negative once it scrolled past).
 */
export interface ScrollAnchor {
  recordRef: RecordRef
  fieldKey: string
  nth: number
  offset: number
}

/**
 * `zap:scroll` and `zap:scroll-to`: the scroll position as fractions (0..1) of
 * the scrollable range (`x` only when the page scrolls sideways), and the
 * field nearest the viewport's top, which aligns two pages of different
 * lengths better than the fraction does.
 */
export interface ScrollPayload {
  y: number
  x?: number
  anchor?: ScrollAnchor
}

/**
 * One Comparar mark (`zap:marks`): every element of the field gets a box in
 * its tone, red for `removed` (the published page), green for `added` (the
 * draft); `active` (the change picked in the list) is solid, tinted and
 * named with `label`.
 */
export interface DiffMark extends FieldRefPayload {
  tone: 'removed' | 'added'
  label: string
  active?: boolean
}

export interface PageMessages {
  'zap:ready': ReadyPayload
  'zap:tags': TagSummary[]
  'zap:click': ClickPayload
  'zap:select': { anchors: PageAnchor[] }
  'zap:navigate': { url: string }
  'zap:error': { code: string; detail?: string }
  'zap:spot': SpotPayload
  'zap:pin': { id: string }
  'zap:paused': PausedPayload
  /** `scroll-sync`: the page scrolled (while sync is on); never for a `zap:scroll-to`. */
  'zap:scroll': ScrollPayload
}

export interface EditorMessages {
  'zap:hello': HelloPayload
  'zap:values': ValuesPayload
  'zap:focus-field': FieldRefPayload
  'zap:mode': OverlayMode
  'zap:zoom': { zoom: number }
  /**
   * Reload the page in place (`refresh` capability): for values the overlay
   * cannot place, once the draft is saved. The browser keeps the scroll and
   * the draft-mode cookie keeps the draft; the new document says ready.
   */
  'zap:refresh': Record<string, never>
  'zap:highlight': { anchors: DomAnchor[] }
  'zap:pins': { pins: Pin[] }
  /** `scroll-sync`: start or stop reporting `zap:scroll`. */
  'zap:scroll-sync': { enabled: boolean }
  /** `scroll-sync`: place the page here (the anchor first), without a `zap:scroll` back. */
  'zap:scroll-to': ScrollPayload
  /** `diff-marks`: the marks to draw; an empty list clears them. */
  'zap:marks': { marks: DiffMark[] }
}

export type PageMessageType = keyof PageMessages
export type EditorMessageType = keyof EditorMessages

export interface Envelope<T extends string = string, P = unknown> {
  source: typeof PROTOCOL_SOURCE
  v: typeof PROTOCOL_VERSION
  session: string
  type: T
  payload: P
}

export type PageMessage = {
  [K in PageMessageType]: Envelope<K, PageMessages[K]>
}[PageMessageType]

export type EditorMessage = {
  [K in EditorMessageType]: Envelope<K, EditorMessages[K]>
}[EditorMessageType]

/** Why an incoming message was dropped. Every drop is counted. */
export type DropReason =
  | 'not-envelope'
  | 'oversize'
  | 'unknown-type'
  | 'invalid-payload'
  | 'wrong-source'
  | 'wrong-origin'
  | 'wrong-session'

export type DropStats = Record<DropReason, number>

export function emptyDropStats(): DropStats {
  return {
    'not-envelope': 0,
    oversize: 0,
    'unknown-type': 0,
    'invalid-payload': 0,
    'wrong-source': 0,
    'wrong-origin': 0,
    'wrong-session': 0,
  }
}

// ── Grammar ─────────────────────────────────────────────────────────────────

const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/
const SESSION_RE = /^[0-9a-f]{32}$/
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/
const PIN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isLocale(value: unknown): value is string {
  return typeof value === 'string' && LOCALE_RE.test(value)
}

/** A session id as `createSession()` makes it: 128 bits, lowercase hex. */
export function isSession(value: unknown): value is string {
  return typeof value === 'string' && SESSION_RE.test(value)
}

// ── Small predicates ────────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

function isFiniteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isOptional<T>(value: unknown, check: (v: unknown) => v is T): boolean {
  return value === undefined || check(value)
}

function isNullableString(value: unknown, max: number): boolean {
  return value === null || value === undefined || isString(value, max)
}

function isHttpUrl(value: unknown): value is string {
  if (!isString(value, MAX_URL_LENGTH)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Longest draft-mode route path accepted. */
export const MAX_DRAFT_ROUTE_LENGTH = 512
const DRAFT_ROUTE_RE = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/

/**
 * A draft-mode route path: starts with exactly one `/`, then only URL path
 * characters (no `\\`, no whitespace or control character, no `?` or `#`), no
 * `//` anywhere and no dot segment, so that joined to any origin it stays on
 * that origin and names the same path. Anything that could carry or imply a
 * host (`//evil.example`, `/\\evil.example`, `https://…`, `/./`, `/..`) fails.
 */
export function isDraftRoutePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_DRAFT_ROUTE_LENGTH) return false
  if (!DRAFT_ROUTE_RE.test(value) || value.includes('//')) return false
  return !value.split('/').some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))
}

function isMode(value: unknown): value is OverlayMode {
  return typeof value === 'string' && (OVERLAY_MODES as readonly string[]).includes(value)
}

function isTheme(value: unknown): value is OverlayTheme {
  if (!isObject(value)) return false
  for (const key of ['outline', 'chip', 'chipText'] as const) {
    const v = value[key]
    if (v !== undefined && !(typeof v === 'string' && COLOR_RE.test(v))) return false
  }
  return true
}

function isZoom(value: unknown): value is number {
  return isFiniteNumber(value, 0.05, 4)
}

export function isPinId(value: unknown): value is string {
  return typeof value === 'string' && PIN_ID_RE.test(value)
}

function isSpotPoint(value: unknown): value is SpotPoint {
  return isObject(value) && isFiniteNumber(value.x, 0, 1) && isFiniteNumber(value.y, 0, 1)
}

/** A pin: id grammar, integer `n` 1..999, and exactly one of `spot` / `dom`. */
export function isPin(value: unknown): value is Pin {
  return (
    isObject(value) &&
    isPinId(value.id) &&
    Number.isInteger(value.n) &&
    isFiniteNumber(value.n, 1, 999) &&
    (value.spot === undefined) !== (value.dom === undefined) &&
    (value.spot === undefined ? isDomAnchor(value.dom) : isSpotPoint(value.spot))
  )
}

function isFieldRef(value: unknown): value is FieldRefPayload & Record<string, unknown> {
  return isObject(value) && isRecordRef(value.recordRef) && isFieldKey(value.fieldKey)
}

function isScrollPayload(value: unknown): value is ScrollPayload {
  if (!isObject(value) || !isFiniteNumber(value.y, 0, 1)) return false
  if (value.x !== undefined && !isFiniteNumber(value.x, 0, 1)) return false
  const anchor = value.anchor
  return (
    anchor === undefined ||
    (isFieldRef(anchor) &&
      Number.isInteger(anchor.nth) &&
      isFiniteNumber(anchor.nth, 0, MAX_ANCHOR_NTH) &&
      isFiniteNumber(anchor.offset, -1e7, 1e7))
  )
}

export function isDiffMark(value: unknown): value is DiffMark {
  return (
    isFieldRef(value) &&
    (value.tone === 'removed' || value.tone === 'added') &&
    isString(value.label, MAX_MARK_LABEL) &&
    (value.active === undefined || typeof value.active === 'boolean')
  )
}

export function isPreviewValue(value: unknown): value is PreviewValue {
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1) return false
  if ('text' in value) return typeof value.text === 'string'
  if ('html' in value) return typeof value.html === 'string'
  if ('url' in value) return isString(value.url, MAX_URL_LENGTH)
  if ('email' in value) return isString(value.email, MAX_EMAIL_LENGTH)
  if ('image' in value) {
    const image = value.image
    return (
      isObject(image) &&
      isNullableString(image.src, MAX_URL_LENGTH) &&
      isNullableString(image.srcset, MAX_URL_LENGTH * 4) &&
      isNullableString(image.alt, 2000)
    )
  }
  return false
}

function isTextQuote(value: unknown): value is TextQuote {
  return (
    isObject(value) &&
    isString(value.exact, MAX_QUOTE_EXACT) &&
    isString(value.prefix, MAX_QUOTE_CONTEXT) &&
    isString(value.suffix, MAX_QUOTE_CONTEXT)
  )
}

function isRect(value: unknown): value is NormalizedRect {
  return (
    isObject(value) &&
    isFiniteNumber(value.x, -1, 2) &&
    isFiniteNumber(value.y, -1, 2) &&
    isFiniteNumber(value.w, 0, 2) &&
    isFiniteNumber(value.h, 0, 2)
  )
}

/** The selector cap is in BYTES (§3.3), so a multi-byte selector counts right. */
export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

export function isDomAnchor(value: unknown): value is DomAnchor {
  if (!isObject(value)) return false
  const tagOk = value.tag === null || (isString(value.tag, 512) && parseTag(value.tag) !== null)
  const selectorOk =
    value.selector === null ||
    (typeof value.selector === 'string' &&
      value.selector.length > 0 &&
      utf8Length(value.selector) <= MAX_SELECTOR_BYTES)
  const viewport = value.viewport
  return (
    tagOk &&
    selectorOk &&
    (value.textQuote === null || isTextQuote(value.textQuote)) &&
    isRect(value.rect) &&
    isObject(viewport) &&
    isFiniteNumber(viewport.w, 0, 100_000) &&
    isFiniteNumber(viewport.h, 0, 10_000_000)
  )
}

export function isPageAnchor(value: unknown): value is PageAnchor {
  if (!isObject(value)) return false
  const field = value.field
  const fieldOk =
    field === null ||
    (isObject(field) &&
      isRecordRef(field.recordRef) &&
      isFieldKey(field.key) &&
      (field.locale === null || isLocale(field.locale)))
  return fieldOk && isDomAnchor(value.dom) && isHttpUrl(value.pageUrl)
}

function isAnchorList<T>(value: unknown, check: (v: unknown) => v is T): value is T[] {
  return Array.isArray(value) && value.length <= MAX_ANCHORS && value.every(check)
}

/**
 * Parse `recordRef#fieldKey` (the `data-zap` grammar). Exported here because
 * `isDomAnchor` checks a reported tag with it; `tags.ts` re-exports it.
 */
export function parseTag(value: string): { recordRef: RecordRef; fieldKey: string } | null {
  const trimmed = value.trim()
  const hash = trimmed.lastIndexOf('#')
  if (hash <= 0) return null
  const recordRef = trimmed.slice(0, hash)
  const fieldKey = trimmed.slice(hash + 1)
  if (!isRecordRef(recordRef) || !isFieldKey(fieldKey)) return null
  return { recordRef, fieldKey }
}

// ── Payload validators per type ─────────────────────────────────────────────

const PAGE_VALIDATORS: { [K in PageMessageType]: (p: unknown) => boolean } = {
  'zap:ready': (p) =>
    isObject(p) &&
    isString(p.version, 32) &&
    Array.isArray(p.capabilities) &&
    // A capability this editor does not know is IGNORED, never a refusal: a
    // newer client on a site must not go dark against an editor that has not
    // shipped its protocol yet (#953, 0.11.0 added two). Bounded all the same.
    p.capabilities.length <= MAX_CAPABILITIES &&
    p.capabilities.every((c) => isString(c, 32)) &&
    isHttpUrl(p.pageUrl) &&
    (p.draftRoute === undefined || p.draftRoute === null || isDraftRoutePath(p.draftRoute)),
  'zap:tags': (p) =>
    Array.isArray(p) &&
    p.length <= MAX_TAG_REPORT &&
    p.every(
      (t) =>
        isObject(t) &&
        typeof t.tag === 'string' &&
        isRecordRef(t.recordRef) &&
        isFieldKey(t.fieldKey) &&
        t.tag === `${t.recordRef}#${t.fieldKey}` &&
        Number.isInteger(t.count) &&
        (t.count as number) > 0 &&
        (t.source === undefined || t.source === 'stega' || t.source === 'attr'),
    ),
  'zap:click': (p) =>
    isFieldRef(p) &&
    (p.rect === undefined ||
      (isObject(p.rect) &&
        isFiniteNumber(p.rect.x, -1e7, 1e7) &&
        isFiniteNumber(p.rect.y, -1e7, 1e7) &&
        isFiniteNumber(p.rect.w, 0, 1e7) &&
        isFiniteNumber(p.rect.h, 0, 1e7))),
  'zap:select': (p) => isObject(p) && isAnchorList(p.anchors, isPageAnchor),
  'zap:navigate': (p) => isObject(p) && isHttpUrl(p.url),
  'zap:error': (p) =>
    isObject(p) &&
    typeof p.code === 'string' &&
    ERROR_CODE_RE.test(p.code) &&
    isOptional(p.detail, (d): d is string => isString(d, 500)),
  'zap:spot': (p) =>
    isObject(p) &&
    isSpotPoint(p.spot) &&
    isObject(p.viewport) &&
    isFiniteNumber(p.viewport.w, 1, 100_000) &&
    isFiniteNumber(p.viewport.h, 1, 10_000_000) &&
    isHttpUrl(p.pageUrl),
  'zap:pin': (p) => isObject(p) && isPinId(p.id),
  'zap:paused': (p) =>
    isObject(p) &&
    (p.reason === 'runaway' || p.reason === 'cap') &&
    Number.isInteger(p.count) &&
    (p.count as number) >= 0,
  'zap:scroll': isScrollPayload,
}

const EDITOR_VALIDATORS: { [K in EditorMessageType]: (p: unknown) => boolean } = {
  'zap:hello': (p) => {
    if (!isObject(p) || !isSession(p.session) || !isString(p.siteKey, 128)) return false
    if (!isLocale(p.locale) || !isRecordRef(p.recordRef) || !isMode(p.mode)) return false
    if (p.theme !== undefined && !isTheme(p.theme)) return false
    if (p.zoom !== undefined && !isZoom(p.zoom)) return false
    if (p.previewToken !== undefined && !isPreviewTokenShape(p.previewToken)) return false
    // Both maps capped and checked entry by entry: labels by field key,
    // `foreign` by full tag to `[label, suffix]`.
    const within = (map: unknown, ok: (key: string, value: unknown) => boolean) =>
      isObject(map) &&
      Object.keys(map).length <= MAX_LABELS &&
      Object.entries(map).every(([key, value]) => ok(key, value))
    return (
      within(p.labels, (key, label) => isFieldKey(key) && isString(label, 200)) &&
      within(
        p.foreign ?? {},
        (tag, pair) =>
          !!parseTag(tag) &&
          Array.isArray(pair) &&
          pair.length === 2 &&
          pair.every((part) => isString(part, 200)),
      )
    )
  },
  'zap:values': (p) => {
    if (!isObject(p) || !isRecordRef(p.recordRef) || !isLocale(p.locale)) return false
    const patch = p.patch
    if (!isObject(patch)) return false
    return Object.entries(patch).every(([key, value]) => isFieldKey(key) && isPreviewValue(value))
  },
  'zap:focus-field': isFieldRef,
  'zap:mode': isMode,
  'zap:zoom': (p) => isObject(p) && isZoom(p.zoom),
  'zap:refresh': isObject,
  'zap:highlight': (p) => isObject(p) && isAnchorList(p.anchors, isDomAnchor),
  'zap:pins': (p) =>
    isObject(p) && Array.isArray(p.pins) && p.pins.length <= MAX_PINS && p.pins.every(isPin),
  'zap:scroll-sync': (p) => isObject(p) && typeof p.enabled === 'boolean',
  'zap:scroll-to': isScrollPayload,
  'zap:marks': (p) =>
    isObject(p) &&
    Array.isArray(p.marks) &&
    p.marks.length <= MAX_MARKS &&
    p.marks.every(isDiffMark),
}

export const PAGE_MESSAGE_TYPES = /* @__PURE__ */ Object.keys(PAGE_VALIDATORS) as PageMessageType[]
export const EDITOR_MESSAGE_TYPES = /* @__PURE__ */ Object.keys(
  EDITOR_VALIDATORS,
) as EditorMessageType[]

// ── Envelope ────────────────────────────────────────────────────────────────

export type ParseResult<M> = { ok: true; message: M } | { ok: false; reason: DropReason }

/** UTF-8 size of the message's JSON form, or `Infinity` when it has none. */
export function messageBytes(data: unknown): number {
  try {
    const json = JSON.stringify(data)
    return json === undefined ? Infinity : utf8Length(json)
  } catch {
    return Infinity
  }
}

function parseWith<M>(
  data: unknown,
  validators: Record<string, (p: unknown) => boolean>,
): ParseResult<M> {
  if (
    !isObject(data) ||
    data.source !== PROTOCOL_SOURCE ||
    data.v !== PROTOCOL_VERSION ||
    typeof data.session !== 'string' ||
    data.session.length > 64 ||
    typeof data.type !== 'string'
  ) {
    return { ok: false, reason: 'not-envelope' }
  }
  // The cap comes before any deep validation: a 50 MB payload is refused on
  // its size, not walked.
  if (messageBytes(data) > MAX_MESSAGE_BYTES) return { ok: false, reason: 'oversize' }
  const validate = Object.prototype.hasOwnProperty.call(validators, data.type)
    ? validators[data.type]
    : undefined
  if (!validate) return { ok: false, reason: 'unknown-type' }
  if (!validate(data.payload)) return { ok: false, reason: 'invalid-payload' }
  return {
    ok: true,
    message: {
      source: PROTOCOL_SOURCE,
      v: PROTOCOL_VERSION,
      session: data.session,
      type: data.type,
      payload: data.payload,
    } as M,
  }
}

/** Parse what the PAGE received: only editor → page types are known. */
export function parseEditorMessage(data: unknown): ParseResult<EditorMessage> {
  return parseWith<EditorMessage>(data, EDITOR_VALIDATORS)
}

/** Parse what the EDITOR received: only page → editor types are known. */
export function parsePageMessage(data: unknown): ParseResult<PageMessage> {
  return parseWith<PageMessage>(data, PAGE_VALIDATORS)
}

export function envelope<T extends string, P>(
  type: T,
  session: string,
  payload: P,
): Envelope<T, P> {
  return { source: PROTOCOL_SOURCE, v: PROTOCOL_VERSION, session, type, payload }
}
