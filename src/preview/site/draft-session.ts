import { isDraftRoutePath } from '../protocol'
import type { SiteContext } from './config'

/**
 * «Editar» on the live site through a short draft-mode session (ADR 041
 * amendment 2026-10-06; zap-cms-v2 item 13, option a).
 *
 * A published page carries no tags: stega and `data-zap` are rendered only in
 * Next's draft mode, and only the browser holding the draft cookie gets them.
 * So when the person presses Editar on an untagged page, the bar:
 *
 * 1. asks Zap for a draft session (`POST /api/public/v1/preview/session`, the
 *    site-client token in `Authorization`, the page's draft route and path in
 *    the body, `credentials: 'omit'`);
 * 2. checks the answer is the site's own draft route on THIS origin (Zap built
 *    it from the verified `Origin`; checked again so a confused answer cannot
 *    send the tab elsewhere);
 * 3. remembers in `sessionStorage` that Editar should reopen on this path, and
 *    until when this tab is in draft mode;
 * 4. navigates the tab there. The site's existing route validates the token
 *    with Zap, sets the draft cookie and redirects back to the page, which
 *    renders tagged; the bar comes back (the tab still holds its token) and
 *    reopens Editar.
 *
 * A page already tagged needs none of this. A page still untagged while this
 * tab is in its draft session simply has no fields, and says so. Signing out
 * revokes the session's preview tokens at Zap and drops the draft cookie
 * through the site's exit route (`{draftRoute}/exit`, the SDK's
 * `createDraftModeExitRoute`), then reloads the page published.
 *
 * Comentar never needs draft mode: nothing here runs for it.
 */

export const DRAFT_SESSION_PATH = '/api/public/v1/preview/session'

/** Editar should reopen after the reload, on this path, if it happens soon. */
export const EDIT_INTENT_KEY = 'eelzap:edit-intent'
/** This tab entered draft mode through a session, until `exp`. */
export const DRAFT_SESSION_KEY = 'eelzap:draft-session'

/** An intent older than this is stale (the navigation never landed). */
const INTENT_MAX_AGE_MS = 2 * 60_000

export const DRAFT_SESSION_MESSAGES = {
  es: {
    preparing: 'Preparando la edición…',
    noRoute:
      'Este sitio no tiene la ruta de vista previa que Editar necesita. Usa Comentar o ábrelo desde Zap.',
    failed: 'No pudimos preparar la página para editar. Inténtalo de nuevo o usa Comentar.',
    rate: (seconds: number) =>
      `Demasiados intentos. Vuelve a intentarlo en ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}.`,
  },
  en: {
    preparing: 'Getting the page ready to edit…',
    noRoute:
      'This site does not have the preview route Edit needs. Use Comment or open it from Zap.',
    failed: 'We could not get the page ready to edit. Try again or use Comment.',
    rate: (seconds: number) =>
      `Too many tries. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
  },
} as const

export type DraftSessionFailure =
  | { ok: false; reason: 'no-route' | 'expired' | 'refused' | 'failed' }
  | { ok: false; reason: 'rate'; retryAfter: number }

export type DraftSessionResult = { ok: true; url: string; expiresAt: number } | DraftSessionFailure

type Ctx = Pick<SiteContext, 'win' | 'zapOrigin' | 'draftRoute'>

function storage(win: Window): Storage | null {
  try {
    return win.sessionStorage
  } catch {
    return null
  }
}

function readJson(win: Window, key: string): Record<string, unknown> | null {
  try {
    const raw = storage(win)?.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function write(win: Window, key: string, value: unknown): void {
  try {
    storage(win)?.setItem(key, JSON.stringify(value))
  } catch {
    // Blocked storage: Editar just does not reopen by itself after the reload.
  }
}

function remove(win: Window, key: string): void {
  try {
    storage(win)?.removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

/** The page as the draft route should return to it: path, query and hash. */
export function currentPath(win: Window): string {
  const { pathname, search, hash } = win.location
  return `${pathname}${search}${hash}`
}

/** True while this tab is inside a draft session it entered (the cookie's life). */
export function inDraftSession(win: Window, now = Date.now()): boolean {
  const value = readJson(win, DRAFT_SESSION_KEY)
  return (
    !!value &&
    typeof value.exp === 'number' &&
    value.exp > now &&
    value.origin === win.location.origin
  )
}

/**
 * Whether Editar should reopen now: an intent left on this very path in the
 * last two minutes. Read once: the intent is removed either way.
 */
export function takeEditIntent(win: Window, now = Date.now()): boolean {
  const value = readJson(win, EDIT_INTENT_KEY)
  remove(win, EDIT_INTENT_KEY)
  return (
    !!value &&
    value.path === win.location.pathname &&
    typeof value.at === 'number' &&
    now - value.at >= 0 &&
    now - value.at < INTENT_MAX_AGE_MS
  )
}

/**
 * The URL Zap answered, accepted only when it is this page's own origin and
 * the announced draft route, carrying a token and a path: anything else is
 * a failure, never a navigation.
 */
export function acceptSessionUrl(raw: unknown, win: Window, draftRoute: string): string | null {
  if (typeof raw !== 'string') return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.origin !== win.location.origin || url.pathname !== draftRoute) return null
  if (!/^zpt_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('token') ?? '')) return null
  const path = url.searchParams.get('path') ?? ''
  if (!path.startsWith('/') || path.startsWith('//')) return null
  return url.toString()
}

/**
 * Ask Zap for a draft session for this page. On success the intent and the
 * session are remembered; the caller navigates (`win.location.assign`).
 */
export async function requestDraftSession(
  ctx: Ctx,
  token: string,
  now = Date.now,
): Promise<DraftSessionResult> {
  const { win } = ctx
  const draftRoute = ctx.draftRoute
  if (!isDraftRoutePath(draftRoute)) return { ok: false, reason: 'no-route' }
  let response: Response
  try {
    response = await win.fetch(`${ctx.zapOrigin}${DRAFT_SESSION_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ draftRoute, path: currentPath(win) }),
    })
  } catch {
    return { ok: false, reason: 'refused' }
  }
  if (response.status === 401) return { ok: false, reason: 'expired' }
  if (response.status === 429) {
    const seconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
    return { ok: false, reason: 'rate', retryAfter: seconds > 0 ? Math.min(seconds, 3600) : 30 }
  }
  if (!response.ok) return { ok: false, reason: 'failed' }
  let body: { url?: unknown; expiresAt?: unknown } | null
  try {
    body = (await response.json()) as typeof body
  } catch {
    return { ok: false, reason: 'failed' }
  }
  const url = acceptSessionUrl(body?.url, win, draftRoute)
  if (!url) return { ok: false, reason: 'failed' }
  const at = now()
  const parsed = typeof body?.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN
  const expiresAt = Number.isFinite(parsed) ? parsed : at + 10 * 60_000
  write(win, EDIT_INTENT_KEY, { path: win.location.pathname, at })
  write(win, DRAFT_SESSION_KEY, { exp: expiresAt, origin: win.location.origin })
  return { ok: true, url, expiresAt }
}

/** The site's draft-exit route by the SDK's convention: `{draftRoute}/exit`. */
export function draftExitUrl(win: Window, draftRoute: string): string {
  const url = new URL(`${draftRoute.replace(/\/+$/, '')}/exit`, win.location.origin)
  url.searchParams.set('path', currentPath(win))
  return url.toString()
}

/**
 * Sign-out: revoke this token's draft sessions at Zap, then, when the page
 * is in draft mode (`tagged`, or this tab entered a session), drop the draft
 * cookie through the site's exit route and reload published. Resolves true
 * when it reloads. Never throws: signing out must work whatever answers.
 */
export async function leaveDraftSession(
  ctx: Ctx,
  token: string,
  tagged: boolean,
): Promise<boolean> {
  const { win } = ctx
  const entered = inDraftSession(win)
  remove(win, EDIT_INTENT_KEY)
  remove(win, DRAFT_SESSION_KEY)
  if (!entered && !tagged) return false
  try {
    await win.fetch(`${ctx.zapOrigin}${DRAFT_SESSION_PATH}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
    })
  } catch {
    // The tokens die with their ten minutes anyway.
  }
  if (!isDraftRoutePath(ctx.draftRoute)) return false
  try {
    // Same origin, so the route's Set-Cookie (both cookies expired, partitioned)
    // applies; its 307 back to the page is not followed.
    const response = await win.fetch(draftExitUrl(win, ctx.draftRoute), {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
    })
    if (response.type !== 'opaqueredirect' && !response.ok) return false
  } catch {
    return false
  }
  win.location.reload()
  return true
}
