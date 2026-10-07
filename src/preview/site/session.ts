import type { ApiResult } from './api'
import type { SiteContext } from './config'
import { readTokenAnswer } from './oauth'
import {
  accessLive,
  clearToken,
  EXPIRY_MARGIN_MS,
  refreshLive,
  writeToken,
  type SiteToken,
} from './token'

/**
 * The site client's token lifecycle (ADR 041 amendment 2026-10-06; Zap item
 * 32): ONE place that knows whether the bar can still talk to Zap, shared by
 * the on-page read, comments, «Editar»'s saves and the draft-session
 * exchange.
 *
 * - **A valid token** for each call (`ensure`): the stored access token while
 *   it has more than 30 seconds left, else a renewal first.
 * - **Renewal** (`refresh`) spends the refresh token at Nest
 *   (`grant_type=refresh_token`, `client_id`, no cookies; Nest answers CORS to
 *   this origin and rotates the refresh token). One renewal at a time: calls
 *   that need it while one is running wait for the same answer.
 * - **A 401 retries once** (`call`): renew, then the same request with the
 *   new token. A second 401, or a renewal that fails, is the expired state.
 * - **Ahead of time**: a timer renews two minutes before the hour ends, so a
 *   person typing in a field never meets the wall; when the tab becomes
 *   visible again (timers sleep with the tab) the same check runs at once.
 *   Renewing touches nothing on the page: the bar keeps its state and an
 *   inline edit in progress is not re-rendered.
 * - **Expired** (`onExpired`, once): the refresh is gone (no refresh token,
 *   past its eight hours, consent revoked or past its 30 days, another
 *   origin). The stored tokens are forgotten and the bar shows «Tu sesión de
 *   Zap expiró» with «Volver a entrar». It is never «No puedes editar ni
 *   comentar»: that card is for a 403 (no seat, or the site refused).
 */

/** Renew this long before the access token's hour ends. */
export const REFRESH_LEAD_MS = 2 * 60_000

export interface TokenSession {
  /** The current access token (possibly near its end; prefer `call`). */
  token(): string
  /** True once renewal failed: the bar shows the expired state. */
  readonly expired: boolean
  /** A token good for the next call, renewing first when needed; null when expired. */
  ensure(): Promise<string | null>
  /** Renew now. Resolves true with a fresh token stored. Single flight. */
  refresh(): Promise<boolean>
  /**
   * Run `request` with a valid token; on a 401, renew and run it once more.
   * An expired session answers `{ ok: false, kind: 'expired' }` without
   * calling.
   */
  call<T>(request: (token: string) => Promise<ApiResult<T>>): Promise<ApiResult<T>>
  /** Stop the timers and the visibility listener. */
  destroy(): void
}

export interface TokenSessionHooks {
  /** Renewal failed for good: show the expired state. Called once. */
  onExpired(): void
}

export interface TokenSessionDeps {
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

type Ctx = Pick<SiteContext, 'win' | 'doc' | 'authOrigin' | 'clientId' | 'siteId'>

export function createTokenSession(
  ctx: Ctx,
  stored: SiteToken,
  hooks: TokenSessionHooks,
  deps: TokenSessionDeps = {},
): TokenSession {
  const { win, doc } = ctx
  const now = deps.now ?? (() => Date.now())
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number) => win.setTimeout(fn, ms))
  const clearT = deps.clearTimeout ?? ((handle: unknown) => win.clearTimeout(handle as number))

  let current: SiteToken = stored
  let expired = false
  let destroyed = false
  let inflight: Promise<boolean> | null = null
  let timer: unknown = null

  function markExpired(): void {
    if (expired || destroyed) return
    expired = true
    stop()
    clearToken(win)
    hooks.onExpired()
  }

  async function renew(): Promise<boolean> {
    if (!refreshLive(current, now()) || !current.refresh) return false
    let response: Response
    try {
      response = await win.fetch(`${ctx.authOrigin}/api/oauth/token`, {
        method: 'POST',
        credentials: 'omit',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: current.refresh,
          client_id: ctx.clientId,
        }),
      })
    } catch {
      return false
    }
    if (!response.ok) return false
    try {
      const next = await readTokenAnswer(response, ctx.siteId, now())
      // Rotation answers a new refresh token; without one, keep nothing stale.
      current = next
      writeToken(win, next)
      return true
    } catch {
      return false
    }
  }

  function refresh(): Promise<boolean> {
    if (expired || destroyed) return Promise.resolve(false)
    inflight ??= renew().finally(() => {
      inflight = null
      if (!destroyed && !expired) schedule()
    })
    return inflight
  }

  /** Renew if the hour is about to end (or has); expire if that fails past the margin. */
  async function check(): Promise<void> {
    if (expired || destroyed) return
    if (current.exp - REFRESH_LEAD_MS > now()) {
      schedule()
      return
    }
    const ok = await refresh()
    if (!ok && !accessLive(current, now())) markExpired()
    else if (!ok) {
      // Still a little hour left: try once more at the margin, then give up.
      stop()
      timer = setT(() => void lastTry(), Math.max(0, current.exp - EXPIRY_MARGIN_MS - now()))
    }
  }

  async function lastTry(): Promise<void> {
    if (!(await refresh())) markExpired()
  }

  function stop(): void {
    if (timer !== null) clearT(timer)
    timer = null
  }

  function schedule(): void {
    stop()
    if (expired || destroyed) return
    timer = setT(() => void check(), Math.max(0, current.exp - REFRESH_LEAD_MS - now()))
  }

  const onVisible = () => {
    if (doc.visibilityState === 'visible') void check()
  }
  doc.addEventListener('visibilitychange', onVisible)

  async function ensure(): Promise<string | null> {
    if (expired) return null
    if (accessLive(current, now())) return current.token
    if (await refresh()) return current.token
    markExpired()
    return null
  }

  async function call<T>(request: (token: string) => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    const token = await ensure()
    if (token === null) return { ok: false, kind: 'expired' }
    const first = await request(token)
    if (first.ok || first.kind !== 'expired') return first
    // A 401 with time left: revoked, or the clock disagrees. Renew and retry once.
    if (await refresh()) {
      const second = await request(current.token)
      if (!second.ok && second.kind === 'expired') markExpired()
      return second
    }
    markExpired()
    return first
  }

  // A session that arrives with its hour already spent renews at once.
  void check()

  return {
    token: () => current.token,
    get expired() {
      return expired
    },
    ensure,
    refresh,
    call,
    destroy() {
      destroyed = true
      stop()
      doc.removeEventListener('visibilitychange', onVisible)
    },
  }
}

export const SESSION_MESSAGES = {
  es: {
    expiredTitle: 'Tu sesión de Zap expiró',
    expiredBody: 'Vuelve a entrar para seguir editando y comentando.',
    signInAgain: 'Volver a entrar',
  },
  en: {
    expiredTitle: 'Your Zap session expired',
    expiredBody: 'Sign in again to keep editing and commenting.',
    signInAgain: 'Sign in again',
  },
} as const
