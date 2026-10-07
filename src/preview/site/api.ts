import type { SiteContext } from './config'

/**
 * The site tools' calls to Zap's public API with the site client's
 * bearer (ADR 041 §3 to §5). The browser sends `Origin`; Zap checks it
 * against the site's preview origins and answers CORS to that origin only.
 *
 * Every answer becomes one of a few outcomes the UI words:
 *
 * - `expired` (401): the hour is up or the token was revoked; sign in again.
 * - `refused`: a network error. A request Zap refuses for a wrong origin,
 *   another site or Live mode off carries NO CORS headers, so the page sees a
 *   network error, not a 403; the UI says «No puedes editar ni comentar en
 *   este sitio».
 * - `forbidden` (a readable 403: no Zap seat, or «Editar» turned off for this
 *   site on the save-to-draft route).
 * - `rate` (429) with `Retry-After` seconds.
 * - `unchanged` (409 `NO_CHANGE`): «Editar» saved what the draft already holds.
 * - `invalid` for anything else.
 *
 * Creates are idempotent: the caller passes the `Idempotency-Key`, kept for
 * one payload so a retry after a 429 or a dropped answer cannot open two
 * threads.
 */

export type ApiFailure =
  | { ok: false; kind: 'expired' | 'refused' | 'forbidden' | 'invalid' | 'unchanged' }
  | { ok: false; kind: 'rate'; retryAfter: number }

export type ApiResult<T> = { ok: true; data: T } | ApiFailure

export interface FieldInfo {
  type: string
  label: string
  /** ENUM: the options in order, by id (what a save sends) and label (what shows). */
  options?: Array<{ id: string; label: string }>
  /** NUMBER, INTEGER, CURRENCY: the field's constraints, when it has them. */
  min?: number
  max?: number
  step?: number
  /** CURRENCY: the ISO 4217 code a value is in (its amount travels in minor units). */
  currency?: string
}

/**
 * A field's value as «Editar» reads and saves it beside text: an ENUM's
 * option id, a number (CURRENCY in minor units), `YYYY-MM-DD` for a DATE, an
 * ISO string for a DATETIME, a boolean, or null when empty.
 */
export type RawValue = string | number | boolean | null

export interface OnPageAnchor {
  fieldKey: string | null
  tag: string | null
  selector: string | null
  rect: { x: number; y: number; w: number; h: number } | null
  /** A pin placed on a point of the page (fractions of the whole document). */
  spot: { x: number; y: number } | null
}

export interface OnPageComment {
  id: string
  status: 'OPEN'
  isChangeRequest: boolean
  createdAt: string
  author: { name: string | null } | null
  excerpt: string | null
  anchors: OnPageAnchor[]
}

export interface OnPage {
  /**
   * The caller's own name and email, and `editorUrl`: the absolute Zap editor
   * URL of the record this page is, or null (optional: older Zaps omit both).
   */
  viewer: { name: string | null; email?: string | null; editorUrl?: string | null }
  /** Whether «Editar» is on for this site (the ADMIN's `liveEditing` switch). */
  liveEditing: boolean
  fields: Record<string, Record<string, FieldInfo>>
  /**
   * The tagged records that are not the record this page is, by ref, to
   * their name: their fields read «… en Configuración» (optional: older
   * Zaps omit it).
   */
  records?: Record<string, string>
  /**
   * The current value (the draft's, else the published one) of each ENUM,
   * NUMBER, INTEGER, CURRENCY, DATE, DATETIME and BOOLEAN field of the tagged
   * records, by ref and field key: what «Editar» opens with, since the page
   * shows them formatted (optional: older Zaps omit it). Never text.
   */
  values?: Record<string, Record<string, RawValue>>
  /** Each tagged record's editor in Zap, by ref, for «Abrir en Zap» on its fields. */
  editorUrls?: Record<string, string>
  comments: OnPageComment[]
  truncated: boolean
}

/** An element anchor (with its field when tagged), or a point of the page. */
export type ApiAnchor =
  | {
      field?: { key: string; locale?: string | null }
      dom: {
        tag?: string
        selector?: string
        textQuote?: { exact: string; prefix: string; suffix: string }
        rect: { x: number; y: number; w: number; h: number }
        viewport: { w: number; h: number }
      }
    }
  | { spot: { x: number; y: number }; viewport: { w: number; h: number } }

export interface CreateBody {
  collection?: string
  slug?: string
  document?: string
  /** «Solicitar cambio»: a change request, assigned by Zap to the record's Responsable. */
  isChangeRequest: boolean
  locale?: string
  /** The page the anchors were made on; element anchors need it. */
  pageUrl: string
  anchors: ApiAnchor[]
  body: string
  proposedValues?: Array<{ fieldKey: string; locale?: string; value: RawValue }>
}

/** «Editar» saves to the draft: always a resolved change request, so no flag. */
export type DraftBody = Omit<CreateBody, 'isChangeRequest'>

const BASE = '/api/public/v1/comments'

async function call<T>(
  ctx: Pick<SiteContext, 'win' | 'zapOrigin'>,
  token: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey
  let response: Response
  try {
    response = await ctx.win.fetch(`${ctx.zapOrigin}${path}`, {
      method: init.method,
      headers,
      credentials: 'omit',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    return { ok: false, kind: 'refused' }
  }
  if (response.status === 401) return { ok: false, kind: 'expired' }
  if (response.status === 403) return { ok: false, kind: 'forbidden' }
  if (response.status === 429) {
    const seconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
    return { ok: false, kind: 'rate', retryAfter: seconds > 0 ? Math.min(seconds, 3600) : 30 }
  }
  // 409 NO_CHANGE: the value already is the stored one (save-to-draft); any
  // other 409 (a duplicate of a unique value) is a failure.
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null
    if (body?.error?.code === 'NO_CHANGE') return { ok: false, kind: 'unchanged' }
  }
  if (!response.ok) return { ok: false, kind: 'invalid' }
  try {
    return { ok: true, data: (await response.json()) as T }
  } catch {
    return { ok: false, kind: 'invalid' }
  }
}

export function fetchOnPage(
  ctx: Pick<SiteContext, 'win' | 'zapOrigin'>,
  token: string,
  pageUrl: string,
  refs: readonly string[],
): Promise<ApiResult<OnPage>> {
  const query = new URLSearchParams({ url: pageUrl })
  if (refs.length > 0) query.set('refs', refs.slice(0, 20).join(','))
  return call<OnPage>(ctx, token, `${BASE}/on-page?${query.toString()}`, { method: 'GET' })
}

/** The part of the create answer the toast reads: who the request went to. */
export interface CreateAnswer {
  thread: { id: string; assignee?: { name: string | null } | null }
}

export function createComment(
  ctx: Pick<SiteContext, 'win' | 'zapOrigin'>,
  token: string,
  body: CreateBody,
  idempotencyKey: string,
): Promise<ApiResult<CreateAnswer>> {
  return call(ctx, token, BASE, { method: 'POST', body, idempotencyKey })
}

export function saveToDraft(
  ctx: Pick<SiteContext, 'win' | 'zapOrigin'>,
  token: string,
  body: DraftBody,
  idempotencyKey: string,
): Promise<ApiResult<{ thread: { id: string }; draftVersionId: string }>> {
  return call(ctx, token, `${BASE}/save-to-draft`, { method: 'POST', body, idempotencyKey })
}

/** A random Idempotency-Key (a v4-shaped UUID). */
export function newIdempotencyKey(win: Window): string {
  const native = (win.crypto as Crypto & { randomUUID?: () => string }).randomUUID
  if (typeof native === 'function') return native.call(win.crypto)
  const bytes = win.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
