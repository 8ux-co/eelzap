import { TOKEN_STORAGE_KEY } from './config'

/**
 * The site client's access token (ADR 041 §7): in memory and in
 * `sessionStorage`, never in `localStorage` or a cookie. It lives one hour and
 * comes with no refresh token, so when it is gone the person signs in again.
 *
 * Stored with its expiry and the site it was issued for: a token for another
 * site, a malformed entry or an expired one reads as nothing and is removed.
 */

export interface SiteToken {
  /** The `eel_at_` access token. */
  token: string
  /** Epoch ms when it stops working. */
  exp: number
  /** The site it was issued for. */
  site: string
}

/** How long before the real expiry we stop using a token, so a call never races it. */
const EXPIRY_MARGIN_MS = 30_000

function store(win: Window): Storage | null {
  try {
    return win.sessionStorage
  } catch {
    return null
  }
}

export function readToken(win: Window, siteId: string, now = Date.now()): SiteToken | null {
  const storage = store(win)
  try {
    const raw = storage?.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<SiteToken>
    if (
      typeof value.token === 'string' &&
      value.token.startsWith('eel_at_') &&
      typeof value.exp === 'number' &&
      value.exp - EXPIRY_MARGIN_MS > now &&
      value.site === siteId
    ) {
      return { token: value.token, exp: value.exp, site: value.site }
    }
    storage?.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // Unreadable entry or blocked storage: no token.
  }
  return null
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
