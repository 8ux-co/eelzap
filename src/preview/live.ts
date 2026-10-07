import {
  isDraftRoutePath,
  isPreviewTokenShape,
  type EditorMessage,
  type PreviewValue,
  type RecordRef,
  type ValuesPayload,
} from './protocol'
import { isLocalHost } from '../boot/local'
import { NEST_PRODUCTION_ORIGIN } from './site/config'
import { startSiteMode } from './site/boot'
import { startRuntime, type PageRuntime, type RuntimeOptions } from './runtime'

/**
 * The Live client («En vivo», `.docs/proposals/zap-cms-v2.md` §2.5–2.7): the
 * page runtime (`runtime.ts`: tag index, overlay, value substitution, bridge),
 * booted by the customer's site itself, which Zap's editor frames by its real
 * URL.
 *
 * ```ts
 * import { initZap, onValues, zapAttrs } from '@8ux-co/eelzap/preview'
 *
 * initZap({ siteKey: 'verdeorigen' })
 * <h1 {...zapAttrs(post, 'title')}>{post.content.title}</h1>
 * onValues(post, (patch) => …)   // optional: values the site computes from
 * ```
 *
 * ## Who the client listens to (§2.6 "Origins")
 *
 * A message from the editor is accepted only when ALL hold, and every other
 * message is dropped and counted (`page-bridge.ts`):
 *
 * 1. `event.source === window.parent`;
 * 2. `event.origin` is the production editor (`https://zap.eel.software`)
 *    or the development origin opted into below. Zap's own preview
 *    deployments are not editors: no deployment-specific origin is compiled
 *    into a public bundle;
 * 3. it parses as a v1 envelope under 256 KB;
 * 4. after the first `zap:hello`, its `session` matches.
 *
 * And the hello itself must name THIS site (`siteKey`); a hello for another
 * site is ignored, and nothing is drawn or stored for it.
 *
 * ## Development: `zapOrigin`
 *
 * `zapOrigin` is the only way to trust another origin, and it is honoured only
 * for a local Zap (`localhost`, `127.0.0.1`, `[::1]` or a `*.localhost` name,
 * over http or https, any port) AND only while the page itself runs on one of
 * those hosts. The boot sets it to the Zap it loaded this file from when that
 * is a local Zap framing a local page, so the site need not pass it. A
 * production page never trusts a local editor, even when the option is left in
 * the site's code; any other value is ignored with a console warning. The
 * production editor needs no option.
 *
 * ## Not framed by Zap, nothing happens
 *
 * Outside a frame the client does nothing at all. Inside a frame it posts one
 * `zap:ready` to the candidate parent origin (and the browser drops it unless
 * the parent really is that Zap origin), and adds nothing to the page — no
 * element, no listener beyond `message` — until a verified hello arrives.
 */

/** The production editor. Always trusted. */
export const ZAP_PRODUCTION_ORIGIN = 'https://zap.eel.software'

/** The header the cookieless fallback sends the preview token in (§2.5). */
export const ZAP_PREVIEW_TOKEN_HEADER = 'x-zap-preview-token'
/** Where the client keeps it, per tab and per frame. */
export const PREVIEW_TOKEN_STORAGE_KEY = 'eelzap:preview-token'

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * The extra origin `zapOrigin` adds, or null. See "Development" above: a
 * local Zap, from a local page, nothing else.
 */
export function developmentZapOrigin(
  zapOrigin: string | undefined,
  pageHostname: string,
): string | null {
  if (!zapOrigin) return null
  const url = parseUrl(zapOrigin)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null
  if (url.origin === ZAP_PRODUCTION_ORIGIN) return null
  if (!isLocalHost(url.hostname) || !isLocalHost(pageHostname)) return null
  return url.origin
}

// ── Record references ───────────────────────────────────────────────────────

export { recordRefsOf, zapAttrs, type EntryLike } from '../refs'
import { recordRefsOf, type EntryLike } from '../refs'
export { cleanStega } from '../stega'

// ── Values ──────────────────────────────────────────────────────────────────

export type ValuesHandler = (patch: Record<string, PreviewValue>, payload: ValuesPayload) => void

interface Subscription {
  refs: RecordRef[]
  handler: ValuesHandler
}

const subscriptions = new Set<Subscription>()

/**
 * Call `handler` with each `zap:values` patch for `entry` (unsaved keystrokes
 * from the editor), for sites that compute things from values. The tagged
 * elements are updated anyway; this is for everything else. Values arrive
 * formatted for display, exactly as the overlay writes them. Returns an
 * unsubscribe function. Works before or after `initZap`.
 */
export function onValues(entry: EntryLike, handler: ValuesHandler): () => void {
  return subscribeRefs(recordRefsOf(entry), handler)
}

/** `onValues` for references already resolved (the React hook). */
export function subscribeRefs(refs: readonly RecordRef[], handler: ValuesHandler): () => void {
  const subscription: Subscription = { refs: [...refs], handler }
  subscriptions.add(subscription)
  return () => {
    subscriptions.delete(subscription)
  }
}

/**
 * The window event every `zap:values` patch is also announced with, so code
 * bundled apart from this client (`useZapLiveUpdates` and `onValues` in
 * `@8ux-co/eelzap/react`, which never bundle the overlay) hears it.
 */
export const VALUES_EVENT = 'eelzap:values'

function dispatchValues(payload: ValuesPayload, win?: Window): void {
  win?.dispatchEvent(new CustomEvent(VALUES_EVENT, { detail: payload }))
  for (const subscription of [...subscriptions]) {
    if (!subscription.refs.includes(payload.recordRef)) continue
    try {
      subscription.handler(payload.patch, payload)
    } catch (error) {
      // A site handler that throws must not take the bridge down with it.
      console.error('eelzap: onValues handler threw', error)
    }
  }
}

// ── Preview token (cookieless fallback) ─────────────────────────────────────

function sessionStore(win: Window | undefined): Storage | null {
  try {
    return win?.sessionStorage ?? null
  } catch {
    return null
  }
}

/**
 * The preview token the editor handed this frame, or null. For the
 * cookieless fallback: send it to your own server with `previewHeaders()`,
 * where `getPreviewToken` from `@8ux-co/eelzap/next` reads it.
 */
export function getPreviewToken(win: Window | undefined = globalWindow()): string | null {
  try {
    const value = sessionStore(win)?.getItem(PREVIEW_TOKEN_STORAGE_KEY) ?? null
    return isPreviewTokenShape(value) ? value : null
  } catch {
    return null
  }
}

/** `{ 'x-zap-preview-token': token }` while this frame has one, else `{}`. */
export function previewHeaders(win?: Window): Record<string, string> {
  const token = getPreviewToken(win ?? globalWindow())
  return token ? { [ZAP_PREVIEW_TOKEN_HEADER]: token } : {}
}

function forgetPreviewToken(win: Window): void {
  try {
    sessionStore(win)?.removeItem(PREVIEW_TOKEN_STORAGE_KEY)
  } catch {
    // Nothing stored.
  }
}

function globalWindow(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window
}

// ── initZap ─────────────────────────────────────────────────────────────────

export interface InitZapOptions {
  /** The Zap site's key (Configuración del sitio). A hello for another site is ignored. */
  siteKey: string
  /**
   * The Zap site's id. Turns on Live suggestion mode outside Zap's frame
   * (§3.4): it names the site's OAuth client. Without it the client only
   * talks to Zap's editor.
   */
  siteId?: string
  /** A local Zap, for development only (see "Development" above). */
  zapOrigin?: string
  /** A local Nest (the OAuth issuer), for development only, under the same rule as `zapOrigin`. */
  authOrigin?: string
  /** The letter pressed with Shift to open «Editar» and «Comentar». Default `Z`; false turns it off. */
  shortcut?: string | false
  /** The language of the suggestion UI; default from `<html lang>`, Spanish otherwise. */
  locale?: 'es' | 'en'
  /** Script-tag build only: the core's own URL, so its chunks load from beside it. */
  chunkBase?: string | null
  /**
   * The site's draft-mode route, a path such as `/api/zap-preview`, announced
   * to the editor in `zap:ready` (§2.5). Anything that is not a plain path is
   * dropped (`isDraftRoutePath`).
   */
  draftRoute?: string | null
  /** The boot saw the shortcut: open the site tools at once. */
  open?: boolean
}

export interface ZapLive {
  /** Framed and listening; false outside a frame or after `destroy`. */
  readonly active: boolean
  /** The underlying runtime, null when inactive (tests and debugging). */
  readonly runtime: PageRuntime | null
  destroy(): void
}

let current: ZapLive | null = null

const INERT: ZapLive = {
  active: false,
  runtime: null,
  destroy() {},
}

/**
 * Start the Live client. Call once per page, as early as convenient; a second
 * call returns the first one's handle (a script tag and a bundled import on
 * the same page do not start two clients).
 */
export function initZap(options: InitZapOptions, runtimeOptions: RuntimeOptions = {}): ZapLive {
  if (current?.active) return current
  const win = runtimeOptions.win ?? globalWindow()
  if (!win) return INERT
  const siteKey = typeof options?.siteKey === 'string' ? options.siteKey.trim() : ''
  if (!siteKey || siteKey.length > 128) {
    console.warn('eelzap: no site key')
    return INERT
  }
  const parent = runtimeOptions.parent ?? (win.parent as Window | null)
  const dev = developmentZapOrigin(options.zapOrigin, win.location.hostname)
  if (options.zapOrigin && !dev && safeOrigin(options.zapOrigin) !== ZAP_PRODUCTION_ORIGIN) {
    console.warn('eelzap: zapOrigin is for a local Zap on a local page')
  }
  if (!parent || (parent as unknown) === win) return startSuggestions(options, win, dev)

  const exact = dev ? [ZAP_PRODUCTION_ORIGIN, dev] : [ZAP_PRODUCTION_ORIGIN]

  let helloOk = false
  const draftRoute = isDraftRoutePath(options.draftRoute) ? options.draftRoute : null
  const runtime = startRuntime(
    {
      editorOrigins: exact,
      preHelloTargets: () => {
        const candidate = parentOriginHint(win)
        return candidate && exact.includes(candidate) ? [candidate] : exact
      },
      draftRoute,
      pageUrl: () => win.location.href,
      lazyOverlay: true,
      accept: (message) => {
        if (message.type === 'zap:hello') {
          helloOk = message.payload.siteKey === siteKey
          return helloOk
        }
        return helloOk
      },
      onMessage: (message: EditorMessage) => {
        if (message.type === 'zap:hello') {
          // A hello without a token (drafts off, or a new session) forgets the
          // last one: a stale token must not keep serving drafts.
          try {
            const token = message.payload.previewToken
            const store = sessionStore(win)
            const last = store?.getItem(PREVIEW_TOKEN_STORAGE_KEY)
            if (token) store?.setItem(PREVIEW_TOKEN_STORAGE_KEY, token)
            else forgetPreviewToken(win)
            // The editor renewed the draft session ahead of its end: the new
            // token goes through the site's draft route in the background,
            // which sets the draft cookies again without navigating, so the
            // next reload still reads drafts. The redirect is not followed.
            if (token && last && last !== token && draftRoute) {
              const query = new URLSearchParams({ token, path: win.location.pathname })
              void win
                .fetch(`${draftRoute}?${query}`, { credentials: 'same-origin', redirect: 'manual' })
                .catch(() => {})
            }
          } catch {
            // Storage blocked: the draft-mode cookie is the only path left.
          }
        } else if (message.type === 'zap:values') {
          dispatchValues(message.payload, win)
        }
      },
    },
    { ...runtimeOptions, win, parent: parent as unknown as RuntimeOptions['parent'] },
  )

  const handle: ZapLive = {
    get active() {
      return current === handle
    },
    runtime,
    destroy() {
      runtime.destroy()
      forgetPreviewToken(win)
      if (current === handle) current = null
    },
  }
  current = handle
  return handle
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let stopSuggestions: (() => void) | null = null

/**
 * Not framed: Live suggestion mode (§3.4, `site/boot.ts`), when the site
 * passed its id. Zap is production or the local dev opt-in, never a preview
 * deployment; Nest likewise (`authOrigin` follows the `zapOrigin` rule).
 */
function startSuggestions(options: InitZapOptions, win: Window, devZap: string | null): ZapLive {
  const siteId = typeof options.siteId === 'string' ? options.siteId.trim() : ''
  if (stopSuggestions || !UUID_RE.test(siteId)) return INERT
  const local = isLocalHost(win.location.hostname)
  const nest = parseUrl(options.authOrigin ?? '')
  const devNest = local && nest && isLocalHost(nest.hostname) ? nest.origin : null
  const stop = startSiteMode({
    win,
    siteId,
    zapOrigin: devZap ?? ZAP_PRODUCTION_ORIGIN,
    authOrigin: devNest ?? NEST_PRODUCTION_ORIGIN,
    shortcut: options.shortcut,
    locale: options.locale,
    chunkBase: options.chunkBase,
    open: options.open,
    draftRoute: isDraftRoutePath(options.draftRoute) ? options.draftRoute : null,
  })
  stopSuggestions = stop
  return {
    active: false,
    runtime: null,
    destroy() {
      stop()
      if (stopSuggestions === stop) stopSuggestions = null
    },
  }
}

function safeOrigin(value: string): string {
  return parseUrl(value)?.origin ?? ''
}

/**
 * Who framed us, as far as the page can tell before the hello: Chrome and
 * Safari expose `location.ancestorOrigins`; otherwise the referrer, which the
 * editor sends as its origin (`referrerpolicy="origin"`). Only a hint: the
 * browser delivers `zap:ready` only if the parent really is that origin.
 */
function parentOriginHint(win: Window): string | null {
  const ancestors = (win.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins
  if (ancestors && ancestors.length > 0) return ancestors[0] ?? null
  const referrer = win.document.referrer
  return referrer ? safeOrigin(referrer) || null : null
}

/** Specs only: forget the page's client and every `onValues` subscription. */
export function __resetLiveForTests(): void {
  current?.destroy()
  current = null
  stopSuggestions?.()
  stopSuggestions = null
  subscriptions.clear()
}
