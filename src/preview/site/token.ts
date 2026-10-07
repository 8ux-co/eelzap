import { TOKEN_STORAGE_KEY } from './config'

/**
 * The site client's tokens (ADR 041 §7): in memory and in `sessionStorage`,
 * never in `localStorage` or a cookie. The access token lives one hour. Since
 * ADR 041's amendment of 2026-10-06 it comes with a short refresh token (eight
 * hours, rotating, redeemable only inside the person's remembered consent and
 * from this origin), which `session.ts` spends to renew the hour without a
 * sign-in; when that fails the person signs in again.
 *
 * Stored with the expiries and the site it was issued for: a token for another
 * site, a malformed entry, or one whose access AND refresh are both spent reads
 * as nothing and is removed.
 */

export interface SiteToken {
  /** The `eel_at_` access token. */
  token: string
  /** Epoch ms when it stops working. */
  exp: number
  /** The site it was issued for. */
  site: string
  /** The `eel_rt_` refresh token, when Nest issued one. */
  refresh?: string
  /** Epoch ms after which the refresh token is not worth trying. */
  rexp?: number
}

/** How long before the real expiry we stop using a token, so a call never races it. */
export const EXPIRY_MARGIN_MS = 30_000

/** A refresh token lives eight hours at Nest (ADR 041 amendment 2026-10-06). */
export const REFRESH_LIFETIME_MS = 8 * 60 * 60 * 1000

function store(win: Window): Storage | null {
  try {
    return win.sessionStorage
  } catch {
    return null
  }
}

function parse(raw: string | null | undefined, siteId: string): SiteToken | null {
  if (!raw) return null
  const value = JSON.parse(raw) as Partial<SiteToken>
  if (
    typeof value.token !== 'string' ||
    !value.token.startsWith('eel_at_') ||
    typeof value.exp !== 'number' ||
    value.site !== siteId
  ) {
    return null
  }
  const refresh =
    typeof value.refresh === 'string' &&
    value.refresh.startsWith('eel_rt_') &&
    typeof value.rexp === 'number'
      ? { refresh: value.refresh, rexp: value.rexp }
      : {}
  return { token: value.token, exp: value.exp, site: value.site, ...refresh }
}

/** True while the access token is still worth sending. */
export function accessLive(value: SiteToken, now = Date.now()): boolean {
  return value.exp - EXPIRY_MARGIN_MS > now
}

/** True while the refresh token is still worth trying. */
export function refreshLive(value: SiteToken, now = Date.now()): boolean {
  return !!value.refresh && typeof value.rexp === 'number' && value.rexp > now
}

/**
 * The stored session while it can still act: a live access token, or a
 * refresh token that may renew it (`session.ts` does). Anything else is
 * removed and reads as null.
 */
export function readSession(win: Window, siteId: string, now = Date.now()): SiteToken | null {
  const storage = store(win)
  try {
    const value = parse(storage?.getItem(TOKEN_STORAGE_KEY), siteId)
    if (value && (accessLive(value, now) || refreshLive(value, now))) return value
    storage?.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // Unreadable entry or blocked storage: no token.
  }
  return null
}

/** The stored session only while its ACCESS token is live (no renewal needed). */
export function readToken(win: Window, siteId: string, now = Date.now()): SiteToken | null {
  const value = readSession(win, siteId, now)
  return value && accessLive(value, now) ? value : null
}

export function writeToken(win: Window, value: SiteToken): void {
  try {
    store(win)?.setItem(TOKEN_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Blocked storage: the token lives in memory for this page only.
  }
}

export function clearToken(win: Window): void {
  try {
    store(win)?.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}
