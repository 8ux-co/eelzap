import {
  PENDING_STORAGE_KEY,
  SIGNIN_CHANNEL,
  siteClientId,
  STATE_PREFIX,
  type CallbackParams,
  type ChunkHandle,
  type ChunkModule,
  type ChunkName,
  type SiteContext,
  type StartOptions,
} from './config'
import { loadChunk } from './load'
import { DEFAULT_SHORTCUT, isShortcut } from './shortcut'
import { readSession } from './token'

/**
 * The core's part of Live suggestion mode (zap-cms-v2 §3.4, ADR 041), for a
 * page that is NOT framed by Zap. It draws nothing and loads nothing until one
 * of these holds:
 *
 * 1. **This page is the OAuth callback**: `{origin}/?code&state&iss` with a
 *    `state` this client minted and `iss` = the compiled-in issuer. In the
 *    sign-in popup the code goes to the opener over
 *    `BroadcastChannel('eel-zap')` and the popup closes; after a full-page
 *    sign-in (the popup was blocked) the `signin` chunk finishes here. Either
 *    way the code leaves the address bar at once.
 * 2. **This tab holds a live token** for this site (or a refresh token that
 *    can renew it, `session.ts`): the `suggest` chunk.
 * 3. **The person asks**: `?zap` in the URL, or the shortcut (Shift Z by
 *    default, never while typing in a field or composing, `shortcut.ts`): the
 *    `signin` chunk, which shows the launcher.
 *
 * Ordinary visitors meet none of these, so they get one `keydown` listener
 * and nothing else. Whatever the callback carries is checked again by the
 * `signin` chunk (state, issuer, the PKCE verifier only the opener holds);
 * this file only decides whether a page looks like ours.
 */

export interface SiteModeOptions {
  win: Window
  siteId: string
  zapOrigin: string
  authOrigin: string
  locale?: 'es' | 'en'
  /** The letter pressed with Shift to open the launcher; false turns the shortcut off. */
  shortcut?: string | false
  /** Script-tag build: the core's own URL, the chunks are its siblings. */
  chunkBase?: string | null
  /** Open at once: the boot already saw the trigger (the shortcut). */
  open?: boolean
  /** The site's draft-mode route, for «Editar» on an untagged page (`draft-session.ts`). */
  draftRoute?: string | null
}

/** The callback params when this page is one of ours, else null. */
export function readCallback(win: Window, authOrigin: string): CallbackParams | null {
  const { pathname, search } = win.location
  if (pathname !== '/' || !search) return null
  const params = new URLSearchParams(search)
  const code = params.get('code')
  const state = params.get('state')
  const iss = params.get('iss')
  if (!code || !state?.startsWith(STATE_PREFIX) || iss !== authOrigin) return null
  return { code, state, iss }
}

function pendingRedirect(win: Window): boolean {
  try {
    return JSON.parse(win.sessionStorage.getItem(PENDING_STORAGE_KEY) ?? '{}').mode === 'redirect'
  } catch {
    return false
  }
}

function pageLocale(doc: Document): 'es' | 'en' {
  return /^en\b/i.test(doc.documentElement.lang) ? 'en' : 'es'
}

export function startSiteMode(options: SiteModeOptions): () => void {
  const { win, siteId } = options
  const doc = win.document
  const key = options.shortcut === undefined ? DEFAULT_SHORTCUT : options.shortcut
  let current: ChunkHandle | null = null
  let opening = false

  const ctx: SiteContext = {
    win,
    doc,
    siteId,
    zapOrigin: options.zapOrigin,
    authOrigin: options.authOrigin,
    clientId: siteClientId(options.zapOrigin, siteId),
    redirectUri: `${win.location.origin}/`,
    locale: options.locale ?? pageLocale(doc),
    shortcut: key,
    draftRoute: options.draftRoute ?? null,
    async open(name: ChunkName, startOptions?: StartOptions) {
      opening = true
      try {
        const module: ChunkModule = await loadChunk(name, options.chunkBase)
        current?.destroy()
        current = module.start(ctx, startOptions)
      } catch (error) {
        console.warn('eelzap: suggestions failed', error)
      } finally {
        opening = false
      }
    },
    close() {
      current?.destroy()
      current = null
    },
  }

  const callback = readCallback(win, options.authOrigin)
  if (callback) {
    // The code and state must not stay in the address bar or the history.
    win.history.replaceState(win.history.state, '', '/')
    if (pendingRedirect(win)) {
      void ctx.open('signin', { callback })
    } else {
      try {
        const channel = new BroadcastChannel(SIGNIN_CHANNEL)
        channel.postMessage({ type: 'eelzap:callback', ...callback })
        channel.close()
      } finally {
        win.close()
      }
    }
    return ctx.close
  }

  const launch = () => {
    if (current || opening) return
    void ctx.open(readSession(win, siteId) ? 'suggest' : 'signin', { reason: 'trigger' })
  }

  if (readSession(win, siteId)) void ctx.open('suggest')
  else if (options.open || new URLSearchParams(win.location.search).has('zap')) launch()

  const onKey = (event: KeyboardEvent) => {
    if (key && isShortcut(event, key)) launch()
  }
  win.addEventListener('keydown', onKey, true)

  return () => {
    win.removeEventListener('keydown', onKey, true)
    ctx.close()
  }
}
