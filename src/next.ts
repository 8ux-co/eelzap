import { createElement } from 'react'

import { ZapPreview as ClientZapPreview, type ZapPreviewProps } from './boot/component'
import { isPreviewTokenShape } from './refs'

/**
 * `@8ux-co/eelzap/next` — the draft-mode route, `isZapPreview()` and the
 * preview boot for a Next.js site (zap-cms-v2 §2.5 "Draft values", §2.7, §3.5).
 *
 * ```ts
 * // app/api/zap-preview/route.ts
 * import { cookies, draftMode } from 'next/headers'
 * import { createDraftModeRoute } from '@8ux-co/eelzap/next'
 *
 * export const GET = createDraftModeRoute({
 *   siteKey: 'verdeorigen',
 *   apiKey: process.env.ZAP_SECRET_KEY!,
 *   draftMode,
 *   cookies,
 * })
 * ```
 *
 * and `<ZapPreview siteKey="verdeorigen" />` in the root layout, which tells
 * Zap's editor the route's path (`zap:ready`, §2.5); the editor joins it to the
 * frame's verified origin and loads `{origin}{route}?token=…&path=…`.
 *
 * ## What the route does, in order
 *
 * 1. Reads `token` and `path` from the query. A token not shaped like Zap's
 *    (`zpt_` + 43 base64url characters) is refused (401) without a request.
 * 2. Refuses a `path` that could leave the site: it must start with one `/`,
 *    carry no backslash or control character, resolve to this request's own
 *    origin, and carry no token itself (400). An open redirect on the site's
 *    own domain is the classic draft-mode hole; this closes it.
 * 3. Validates the token WITH ZAP (`GET /api/public/v1/preview/token`),
 *    sending the site's own API key beside it, and Zap checks the token was
 *    minted for the site that key belongs to. Without that binding, any Zap
 *    account could mint a token for its own site and switch YOUR site into
 *    draft mode, with YOUR server rendering THEIR drafts on your domain. The
 *    site key alone cannot carry it: it is unique within a workspace only, so
 *    anyone can name a site `verdeorigen` in a workspace of their own (P7
 *    audit). The answer's site key is compared too. An unknown, expired or
 *    revoked token, or another site's, is refused (401 / 403); Zap
 *    unreachable is 502. Nothing is enabled on a refusal.
 * 4. Enables Next's draft mode and stores the token in its own cookie, so the
 *    server can read drafts with it (`getValidPreviewToken`, which checks it
 *    with Zap again; `getPreviewToken` only checks its shape). Both cookies are
 *    `SameSite=None; Secure; Partitioned; HttpOnly`: the page renders inside
 *    Zap's frame, a third-party context where anything else is dropped, and
 *    Chrome keeps a partitioned (CHIPS) cookie under third-party cookie
 *    restrictions. Safari blocks frame cookies regardless; the client's
 *    cookieless fallback covers it (`previewHeaders` → `getValidPreviewToken`).
 * 5. Redirects (307) to `path`, WITHOUT the token, `Cache-Control: no-store`,
 *    `Referrer-Policy: no-referrer`.
 *
 * `createDraftModeExitRoute` ends the preview: both cookies expired, same
 * attributes, and a redirect through the same `safeRedirectPath`.
 *
 * Next is not imported: `draftMode` and `cookies` are passed in, so the
 * helper works with any Next version that has them and is testable alone.
 */

/** The cookie the token travels in after the exchange. */
export const PREVIEW_TOKEN_COOKIE = '__zap_preview'
/** Next's own draft-mode cookie, re-issued partitioned. */
export const NEXT_DRAFT_COOKIE = '__prerender_bypass'
/** The header the client's cookieless fallback sends (`previewHeaders`). */
export const PREVIEW_TOKEN_HEADER = 'x-zap-preview-token'
export const DEFAULT_ZAP_ORIGIN = 'https://zap.eel.software'
export const TOKEN_VALIDATION_PATH = '/api/public/v1/preview/token'
/** The header the site's own API key travels in to the validation call. */
export const SITE_API_KEY_HEADER = 'X-Zap-Site-Api-Key'
/** A preview token lives ten minutes (§3.5); its cookie no longer. */
const PREVIEW_COOKIE_MAX_AGE = 600
const VALIDATION_TIMEOUT_MS = 5000

interface DraftModeLike {
  enable(): void | Promise<void>
}

interface CookieStoreLike {
  get(name: string): { value: string } | undefined
}

export interface DraftModeRouteOptions {
  /** The Zap site's key: a token minted for any other site is refused. */
  siteKey: string
  /**
   * One of the site's own API keys (the secret key the server already reads
   * with, or its public key). Zap refuses a token minted for any other site
   * than this key's. Server-side only; it is sent to Zap and nowhere else.
   */
  apiKey: string
  /** `draftMode` from `next/headers`. */
  draftMode: () => DraftModeLike | Promise<DraftModeLike>
  /** `cookies` from `next/headers`, to re-issue Next's draft cookie partitioned. */
  cookies?: () => CookieStoreLike | Promise<CookieStoreLike>
  /** Where Zap answers. Default `https://zap.eel.software`. */
  zapOrigin?: string
  /** Injected in specs. */
  fetch?: typeof fetch
}

export type DraftModeRefusal =
  | 'invalid_token'
  | 'invalid_path'
  | 'token_refused'
  | 'wrong_site'
  | 'zap_unreachable'

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

function refuse(status: number, error: DraftModeRefusal): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

/** A 307 to `path` (already `safeRedirectPath`ed) that sets `cookies`. */
function redirect(path: string, cookies: string[]): Response {
  const headers = new Headers({ Location: path, ...NO_STORE })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 307, headers })
}

function requireKeys(options: { siteKey?: string; apiKey?: string } | undefined): void {
  if (!options?.siteKey || !options.apiKey) {
    throw new Error('eelzap/next: siteKey and apiKey (the site API key) are required')
  }
}

// eslint-disable-next-line no-control-regex
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f\\]/

/**
 * The path to redirect to, or null when it could leave the site. Returned
 * as path + query + hash, never absolute, so the `Location` stays on the
 * host the browser asked.
 */
export function safeRedirectPath(raw: string | null, requestUrl: string): string | null {
  const value = raw ?? '/'
  if (value.length === 0 || value.length > 2048) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (UNSAFE_PATH_CHARS.test(value)) return null
  let base: URL
  let target: URL
  try {
    base = new URL(requestUrl)
    target = new URL(value, base)
  } catch {
    return null
  }
  if (target.origin !== base.origin) return null
  // Dot segments can collapse into a leading `//` (`/.//evil.example`,
  // `/a/..//evil.example`), and a `Location` of `//evil.example` is
  // protocol-relative: another host. The resolved path must not start so.
  if (target.pathname.startsWith('//')) return null
  if (/zpt_/i.test(target.search) || /zpt_/i.test(target.hash)) return null
  return `${target.pathname}${target.search}${target.hash}`
}

function cookieHeader(name: string, value: string, maxAge?: number): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=None', 'Partitioned']
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`)
  return parts.join('; ')
}

type ZapValidationOptions = Pick<DraftModeRouteOptions, 'apiKey' | 'zapOrigin' | 'fetch'>

type ZapVerdict =
  | { ok: true; siteKey: string; expiresAt: number | null }
  | { ok: false; status: number; code: string | null }

/** An expiry Zap may answer beside the site (ISO string or epoch ms), else null. */
function readExpiry(value: unknown): number | null {
  const at = typeof value === 'string' ? Date.parse(value) : value
  return typeof at === 'number' && Number.isFinite(at) ? at : null
}

/** Ask Zap whether the token is live, and for which site. */
async function validateWithZap(token: string, options: ZapValidationOptions): Promise<ZapVerdict> {
  const doFetch = options.fetch ?? fetch
  const origin = new URL(options.zapOrigin ?? DEFAULT_ZAP_ORIGIN).origin
  const response = await doFetch(`${origin}${TOKEN_VALIDATION_PATH}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      [SITE_API_KEY_HEADER]: options.apiKey,
      Accept: 'application/json',
    },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null
    const code = typeof body?.error?.code === 'string' ? body.error.code : null
    return { ok: false, status: response.status, code }
  }
  const body = (await response.json().catch(() => null)) as {
    site?: { key?: unknown }
    expiresAt?: unknown
    token?: { expiresAt?: unknown }
  } | null
  const key = body?.site?.key
  return typeof key === 'string'
    ? { ok: true, siteKey: key, expiresAt: readExpiry(body?.expiresAt ?? body?.token?.expiresAt) }
    : { ok: false, status: 502, code: null }
}

export function createDraftModeRoute(options: DraftModeRouteOptions) {
  requireKeys(options)
  return async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    if (!isPreviewTokenShape(token)) return refuse(401, 'invalid_token')
    const path = safeRedirectPath(url.searchParams.get('path'), request.url)
    if (path === null) return refuse(400, 'invalid_path')

    let verdict: ZapVerdict
    try {
      verdict = await validateWithZap(token, options)
    } catch {
      return refuse(502, 'zap_unreachable')
    }
    if (!verdict.ok) {
      if (verdict.status >= 500) return refuse(502, 'zap_unreachable')
      return verdict.code === 'WRONG_SITE'
        ? refuse(403, 'wrong_site')
        : refuse(401, 'token_refused')
    }
    if (verdict.siteKey !== options.siteKey) return refuse(403, 'wrong_site')

    const draft = await options.draftMode()
    await draft.enable()

    const cookies = [cookieHeader(PREVIEW_TOKEN_COOKIE, token, PREVIEW_COOKIE_MAX_AGE)]
    // Next set its own draft cookie when `enable()` ran, without
    // `Partitioned`; the same value again, partitioned, is the copy Chrome
    // keeps inside a third-party frame.
    const bypass = options.cookies ? (await options.cookies()).get(NEXT_DRAFT_COOKIE)?.value : null
    if (bypass && /^[A-Za-z0-9._~-]+$/.test(bypass)) {
      // No longer than the token: past it the page would sit in draft mode
      // with nothing to read drafts with.
      cookies.push(cookieHeader(NEXT_DRAFT_COOKIE, bypass, PREVIEW_COOKIE_MAX_AGE))
    }
    return redirect(path, cookies)
  }
}

interface DraftModeExitLike {
  disable(): void | Promise<void>
}

export interface DraftModeExitRouteOptions {
  /** `draftMode` from `next/headers`. */
  draftMode: () => DraftModeExitLike | Promise<DraftModeExitLike>
}

/**
 * The route that ends a preview: `createDraftModeRoute`'s twin.
 *
 * ```ts
 * // app/api/zap-preview/exit/route.ts
 * import { draftMode } from 'next/headers'
 * import { createDraftModeExitRoute } from '@8ux-co/eelzap/next'
 *
 * export const GET = createDraftModeExitRoute({ draftMode })
 * ```
 *
 * Disables Next's draft mode, then expires BOTH cookies the enable route set,
 * with the same `SameSite=None; Secure; Partitioned; HttpOnly; Path=/`: a
 * partitioned cookie is only replaced by a partitioned one, so `disable()`
 * alone (Next's unpartitioned expiry) would leave the framed copy alive.
 * Redirects (307) to `?path=` when `safeRedirectPath` accepts it, else to `/`.
 */
export function createDraftModeExitRoute(options: DraftModeExitRouteOptions) {
  if (!options?.draftMode) throw new Error('eelzap/next: draftMode is required')
  return async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = safeRedirectPath(url.searchParams.get('path'), request.url) ?? '/'
    const draft = await options.draftMode()
    await draft.disable()
    return redirect(path, [
      cookieHeader(NEXT_DRAFT_COOKIE, '', 0),
      cookieHeader(PREVIEW_TOKEN_COOKIE, '', 0),
    ])
  }
}

interface HeaderSource {
  get(name: string): string | null | undefined
}

/**
 * The preview token for this request, from the client's header (the
 * cookieless fallback) or the cookie the draft-mode route set; null when
 * neither carries a well-formed one. Pass it to the server SDK as the
 * credential (`createClient({ apiKey: token })`), which reads drafts with it.
 *
 * ```ts
 * import { cookies, headers } from 'next/headers'
 * const token = getPreviewToken({ headers: await headers(), cookies: await cookies() })
 * ```
 */
export function getPreviewToken(
  source: Request | { headers?: HeaderSource; cookies?: CookieStoreLike },
): string | null {
  const request = source instanceof Request
  const fromHeader = source.headers?.get(PREVIEW_TOKEN_HEADER)
  if (isPreviewTokenShape(fromHeader)) return fromHeader
  const fromCookie = request
    ? readCookie(source.headers.get('cookie'), PREVIEW_TOKEN_COOKIE)
    : source.cookies?.get(PREVIEW_TOKEN_COOKIE)?.value
  return isPreviewTokenShape(fromCookie) ? fromCookie : null
}

export interface ValidPreviewTokenOptions {
  /** The Zap site's key: a token minted for any other site is refused. */
  siteKey: string
  /** One of the site's own API keys, as for `createDraftModeRoute`. Server-side only. */
  apiKey: string
  /** Where Zap answers. Default `https://zap.eel.software`. */
  zapOrigin?: string
  /** Injected in specs. */
  fetch?: typeof fetch
}

/** A confirmed token is trusted this long at most, less when it expires sooner. */
const VALID_TOKEN_CACHE_MS = 60_000
/** A refused token is re-asked after this long. */
const REFUSED_TOKEN_CACHE_MS = 10_000
const TOKEN_CACHE_MAX = 500
const tokenCache = new Map<string, { valid: boolean; until: number }>()

function rememberVerdict(key: string, valid: boolean, until: number): void {
  tokenCache.delete(key)
  // Full: drop the oldest (a Map iterates in insertion order).
  if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value!)
  tokenCache.set(key, { valid, until })
}

/** Test-only: forget every cached verdict. */
export function __resetPreviewTokenCacheForTests(): void {
  tokenCache.clear()
}

/**
 * `getPreviewToken`, checked with Zap: the token for this request only when
 * Zap confirms it is live AND was minted for this site, else null.
 *
 * `getPreviewToken` accepts any well-formed `x-zap-preview-token` header, and
 * anyone can send one: a token minted for their own Zap site, or one that
 * expired or was revoked. **Use this on every request that serves drafts**,
 * so a stranger's token never makes your server render drafts. It asks
 * `GET /api/public/v1/preview/token` exactly as the draft-mode route does
 * (the token as the bearer, your API key beside it) and compares the site
 * key Zap answers with `siteKey`.
 *
 * Verdicts are cached in memory per token, site and key, at most 500 of
 * them: a confirmed token for 60 seconds or until the expiry Zap answers,
 * whichever comes first; a refused one for 10 seconds. Zap unreachable is
 * null and not cached. The token is never logged.
 *
 * ```ts
 * import { cookies, headers } from 'next/headers'
 * const token = await getValidPreviewToken(
 *   { headers: await headers(), cookies: await cookies() },
 *   { siteKey: 'verdeorigen', apiKey: process.env.ZAP_SECRET_KEY! },
 * )
 * ```
 */
export async function getValidPreviewToken(
  source: Request | { headers?: HeaderSource; cookies?: CookieStoreLike },
  options: ValidPreviewTokenOptions,
): Promise<string | null> {
  requireKeys(options)
  const token = getPreviewToken(source)
  if (token === null) return null

  // Keyed by everything the verdict depends on: one process may serve
  // several sites, and a token valid for one is not valid for another.
  const key = `${options.zapOrigin}\n${options.siteKey}\n${options.apiKey}\n${token}`
  const now = Date.now()
  const cached = tokenCache.get(key)
  if (cached && cached.until > now) return cached.valid ? token : null

  let verdict: ZapVerdict
  try {
    verdict = await validateWithZap(token, options)
  } catch {
    return null
  }
  if (!verdict.ok) {
    if (verdict.status < 500) rememberVerdict(key, false, now + REFUSED_TOKEN_CACHE_MS)
    return null
  }
  if (verdict.siteKey !== options.siteKey) {
    rememberVerdict(key, false, now + REFUSED_TOKEN_CACHE_MS)
    return null
  }
  if (verdict.expiresAt !== null && verdict.expiresAt <= now) {
    rememberVerdict(key, false, now + REFUSED_TOKEN_CACHE_MS)
    return null
  }
  const until = Math.min(now + VALID_TOKEN_CACHE_MS, verdict.expiresAt ?? Number.POSITIVE_INFINITY)
  rememberVerdict(key, true, until)
  return token
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

/**
 * The path `createDraftModeRoute` is documented at, and the one `ZapPreview`
 * announces to Zap's editor unless told otherwise (§2.5): mount the route at
 * `app/api/zap-preview/route.ts`, or pass `draftRoute` with its path.
 */
export const DEFAULT_DRAFT_ROUTE = '/api/zap-preview'

/**
 * The preview boot for a Next.js site (§2.7): render it once, in the root
 * layout. It announces the draft-mode route (`/api/zap-preview` unless
 * `draftRoute` says otherwise; `null` for none) and loads the overlay only in
 * a preview session. Pass `preview={(await draftMode()).isEnabled}` so a
 * draft-mode page in its own tab boots too.
 *
 * ```tsx
 * import { draftMode } from 'next/headers'
 * import { ZapPreview } from '@8ux-co/eelzap/next'
 *
 * <ZapPreview siteKey="verdeorigen" siteId="…uuid…" preview={(await draftMode()).isEnabled} />
 * ```
 *
 * A server component that renders the client boot from `@8ux-co/eelzap/react`.
 */
export function ZapPreview(props: ZapPreviewProps) {
  return createElement(ClientZapPreview, {
    ...props,
    draftRoute: props.draftRoute === undefined ? DEFAULT_DRAFT_ROUTE : props.draftRoute,
  })
}

/**
 * True when this request carries a preview token in the shape Zap mints (the
 * client's header or the draft-mode cookie): a cheap hint for rendering
 * choices (skip a cache, render `ZapPreview` with `preview`). It does NOT
 * prove the token is live or yours; serve drafts only with
 * `getValidPreviewToken`.
 */
export function isZapPreview(
  source: Request | { headers?: HeaderSource; cookies?: CookieStoreLike },
): boolean {
  return getPreviewToken(source) !== null
}
