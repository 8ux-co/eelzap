import {
  PENDING_STORAGE_KEY,
  SITE_CLIENT_SCOPE,
  STATE_PREFIX,
  type CallbackParams,
  type SiteContext,
} from './config'
import type { SiteToken } from './token'

/**
 * The site client's side of OAuth 2.1 with Nest (ADR 024, ADR 041): a public
 * client, PKCE S256, `state`, and an `iss` check (RFC 9207). Pure functions
 * plus the one `fetch`, so every refusal is a unit spec.
 *
 * - `state` is `zap1.<128 random bits>` for the popup, and
 *   `zap1.<random>.<return path>` for the full-page redirect (spec §3.4 step 4:
 *   "the return path in `state`"). The callback must bring back EXACTLY the
 *   state this tab minted; the return path is honoured only as a same-origin
 *   path.
 * - `iss` must equal the compiled-in issuer exactly.
 * - The code is exchanged once, with the verifier only this tab holds, as a
 *   form POST with no custom header (no preflight; Nest answers CORS to the
 *   client's own redirect origins only) and no cookies.
 * - Nest issues no refresh token to this client; one in the answer anyway is
 *   ignored, never stored.
 */

export interface PendingSignIn {
  state: string
  verifier: string
  mode: 'popup' | 'redirect'
}

export type CallbackProblem = 'state' | 'iss' | 'code'

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(win: Window, size: number): string {
  return base64url(win.crypto.getRandomValues(new Uint8Array(size)))
}

/** A 43-character verifier (32 random bytes), RFC 7636 §4.1. */
export function createVerifier(win: Window): string {
  return randomToken(win, 32)
}

/** `BASE64URL(SHA256(verifier))`, RFC 7636 §4.2. */
export async function challengeFor(win: Window, verifier: string): Promise<string> {
  const digest = await win.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/** A same-origin path: one leading slash, no scheme, no `//host`, no backslash tricks. */
export function isReturnPath(value: string): boolean {
  return /^\/(?![/\\])/.test(value) && !/[\\\s]/.test(value) && value.length <= 2048
}

export function createState(win: Window, returnPath?: string): string {
  const nonce = randomToken(win, 16)
  if (returnPath === undefined || !isReturnPath(returnPath)) return `${STATE_PREFIX}${nonce}`
  return `${STATE_PREFIX}${nonce}.${base64url(new TextEncoder().encode(returnPath))}`
}

/** The return path a redirect `state` carries, or null. */
export function returnPathOf(state: string): string | null {
  const encoded = state.slice(STATE_PREFIX.length).split('.')[1]
  if (!encoded) return null
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
    const path = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
    return isReturnPath(path) ? path : null
  } catch {
    return null
  }
}

export function authorizeUrl(
  ctx: Pick<SiteContext, 'authOrigin' | 'clientId' | 'redirectUri'>,
  state: string,
  challenge: string,
): string {
  const url = new URL('/oauth/authorize', ctx.authOrigin)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: ctx.clientId,
    redirect_uri: ctx.redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: SITE_CLIENT_SCOPE,
  }).toString()
  return url.toString()
}

/**
 * Null when the callback answers `pending`; otherwise what is wrong with it.
 * Exact comparisons only: a callback for another sign-in (another tab, an
 * attacker's code pushed at us) has another state; a code from another
 * issuer has another `iss`.
 */
export function checkCallback(
  callback: Partial<CallbackParams> | null | undefined,
  pending: PendingSignIn | null,
  authOrigin: string,
): CallbackProblem | null {
  if (!pending || !callback || callback.state !== pending.state) return 'state'
  if (callback.iss !== authOrigin) return 'iss'
  if (typeof callback.code !== 'string' || !callback.code || callback.code.length > 512) {
    return 'code'
  }
  return null
}

export class ExchangeError extends Error {
  constructor(readonly status: number) {
    super(`token exchange failed (${status})`)
    this.name = 'ExchangeError'
  }
}

/** Trade the code for the access token. Never sends cookies; keeps no refresh token. */
export async function exchangeCode(
  ctx: Pick<SiteContext, 'win' | 'authOrigin' | 'clientId' | 'redirectUri' | 'siteId'>,
  code: string,
  verifier: string,
  now = Date.now(),
): Promise<SiteToken> {
  const response = await ctx.win.fetch(`${ctx.authOrigin}/api/oauth/token`, {
    method: 'POST',
    credentials: 'omit',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: ctx.clientId,
      redirect_uri: ctx.redirectUri,
      code_verifier: verifier,
    }),
  })
  if (!response.ok) throw new ExchangeError(response.status)
  const body = (await response.json().catch(() => null)) as {
    access_token?: unknown
    expires_in?: unknown
  } | null
  const token = body?.access_token
  const expiresIn = body?.expires_in
  if (
    typeof token !== 'string' ||
    !/^eel_at_[A-Za-z0-9_-]{8,200}$/.test(token) ||
    typeof expiresIn !== 'number' ||
    !(expiresIn > 0)
  ) {
    throw new ExchangeError(502)
  }
  // At most the hour the ADR promises, whatever the answer claims.
  return { token, exp: now + Math.min(expiresIn, 3600) * 1000, site: ctx.siteId }
}

// ── The pending full-page sign-in (sessionStorage, this tab only) ───────────

export function savePending(win: Window, pending: PendingSignIn): void {
  try {
    win.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending))
  } catch {
    // Blocked storage: the redirect cannot be finished; the popup path still works.
  }
}

/** Read AND forget: a pending sign-in is good for one callback. */
export function takePending(win: Window): PendingSignIn | null {
  try {
    const raw = win.sessionStorage.getItem(PENDING_STORAGE_KEY)
    win.sessionStorage.removeItem(PENDING_STORAGE_KEY)
    const value = raw ? (JSON.parse(raw) as Partial<PendingSignIn>) : null
    if (
      value &&
      typeof value.state === 'string' &&
      typeof value.verifier === 'string' &&
      (value.mode === 'popup' || value.mode === 'redirect')
    ) {
      return { state: value.state, verifier: value.verifier, mode: value.mode }
    }
  } catch {
    // Nothing usable.
  }
  return null
}
