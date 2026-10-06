import { DEFAULT_SHORTCUT, isShortcut } from '../preview/site/shortcut'
import { LOCAL_ORIGIN } from './local'
import { PREVIEW_RELEASE_INTEGRITY, PREVIEW_RELEASE_PATH } from './release'

/**
 * The boot (`.docs/proposals/zap-cms-v2.md` §2.7 "What a visitor pays",
 * §7.5): the only Zap code an ordinary visitor runs. Under 1 KB gzip, and it
 * makes NO request unless a preview session is present:
 *
 * 1. the server says a draft-mode session is active (`preview: true`);
 * 2. the page is framed by a Zap origin: framed, and, where the browser tells
 *    (`location.ancestorOrigins`, Chrome and Safari), the parent is the
 *    production editor or a local Zap seen from a local page (Zap's own
 *    preview deployments are not editors) (`./local.ts`: localhost, 127.0.0.1,
 *    [::1] or *.localhost, over http or https); where it cannot tell
 *    (Firefox), any frame counts and the overlay itself refuses every editor
 *    that is not Zap;
 *    and with a site id (suggestion mode, §3.4):
 * 3. the URL carries `?zap`;
 * 4. this page is the OAuth callback of a sign-in this client started
 *    (`/?code&state=zap1.…`);
 * 5. this tab already holds a suggestion session or a pending sign-in
 *    (`sessionStorage`);
 * 6. the shortcut is pressed: Shift Z by default, never while the person is
 *    typing in a field or composing with an IME (`preview/site/shortcut.ts`).
 *
 * Only then does it add one `<script>` for `./preview`: the release path
 * compiled in (`./release.ts`) with its SRI hash, on a Zap origin. The origin
 * is the editor that framed the page when the browser names it and it is a
 * Zap origin (so a local Zap serves its own overlay), else `zapOrigin` when it
 * is a Zap origin by the same rule (a local Zap from a local page), else
 * production. Never a URL from the page or the query string, and the SRI
 * hash means only the released bytes run, whichever Zap serves them.
 *
 * One script per document: a second boot on the same page (React StrictMode
 * runs every effect twice, a remount, a script tag beside the component) finds
 * the first one by its SRI hash and adds nothing. It reads the parent's
 * origin, the URL, sessionStorage keys and key presses; it writes nothing and
 * draws nothing.
 */

export interface ZapBootOptions {
  /** The Zap site's key. */
  siteKey: string
  /** The Zap site's id: turns on suggestion mode on the live site (§3.4). */
  siteId?: string
  /** The site's draft-mode route path, announced to the editor (§2.5). */
  draftRoute?: string | null
  /** The server saw an active draft-mode session (Next: `draftMode().isEnabled`). */
  preview?: boolean
  /** The letter pressed with Shift to open «Editar» and «Comentar»; default `Z`, false for none. */
  shortcut?: string | false
  /**
   * The Zap the site works against (`EELZAP_ORIGIN`): the overlay loads from
   * it and trusts it. Honoured for a local Zap from a local page
   * (development) and for production; anything else is ignored.
   */
  zapOrigin?: string
  /** A local Nest, under the same rule. */
  authOrigin?: string
}

/**
 * The string options and the `data-*` attribute each travels in to the
 * overlay's script (and, in the script-tag boot, comes from).
 */
export const BOOT_ATTRIBUTES = {
  siteKey: 'site',
  siteId: 'site-id',
  draftRoute: 'zap-draft-route',
  shortcut: 'zap-shortcut',
  zapOrigin: 'zap-origin',
  authOrigin: 'auth-origin',
} as const

const ZAP = 'https://zap.eel.software'

/** A Zap origin, as seen from `page`: see the list above. */
function isZap(origin: string, page: string): boolean {
  return origin === ZAP || (LOCAL_ORIGIN.test(origin) && LOCAL_ORIGIN.test(page))
}

/**
 * The parent's origin: undefined when not framed, '' when framed but the
 * browser does not say by whom (Firefox).
 */
function parentOrigin(win: Window): string | undefined {
  if (win.parent === win) return undefined
  const ancestors = (win.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins
  return ancestors?.[0] ?? ''
}

function suggesting(win: Window): boolean {
  const query = new URLSearchParams(win.location.search)
  if (query.has('zap')) return true
  if (
    win.location.pathname === '/' &&
    query.has('code') &&
    /^zap1\./.test(query.get('state') ?? '')
  )
    return true
  try {
    const store = win.sessionStorage
    return !!(store.getItem('eelzap:site-token') || store.getItem('eelzap:signin'))
  } catch {
    return false
  }
}

/** Start the boot. Returns a function that removes its one listener. */
export function bootZapPreview(options: ZapBootOptions, win: Window = window): () => void {
  const page = win.location.origin
  const parent = parentOrigin(win)
  // The framing editor when it is Zap, else '' (not framed, unnamed, or not Zap).
  const editor = parent && isZap(parent, page) ? parent : ''
  // Where the overlay comes from (see above): that editor, the configured
  // Zap (an exact origin, as `EELZAP_ORIGIN` holds it), or production.
  const zap = editor || (isZap(options.zapOrigin ?? '', page) ? options.zapOrigin! : ZAP)
  let loaded = false
  const load = (open?: boolean) => {
    if (loaded || !PREVIEW_RELEASE_PATH) return
    loaded = true
    stop()
    const doc = win.document
    if (doc.querySelector(`script[integrity="${PREVIEW_RELEASE_INTEGRITY}"]`)) return
    const script = doc.createElement('script')
    script.src = zap + PREVIEW_RELEASE_PATH
    script.setAttribute('integrity', PREVIEW_RELEASE_INTEGRITY)
    script.setAttribute('crossorigin', 'anonymous')
    let key: keyof typeof BOOT_ATTRIBUTES
    for (key in BOOT_ATTRIBUTES) {
      const value = key === 'shortcut' && options.shortcut === false ? 'off' : options[key]
      if (typeof value === 'string') script.setAttribute(`data-${BOOT_ATTRIBUTES[key]}`, value)
    }
    // The overlay trusts the Zap it came from (a local one only from a local page).
    script.setAttribute('data-zap-origin', zap)
    if (open) script.setAttribute('data-zap-open', '')
    doc.head.appendChild(script)
  }

  const key = options.shortcut === undefined ? DEFAULT_SHORTCUT : options.shortcut
  const onKey = (event: KeyboardEvent) => {
    if (key && isShortcut(event, key)) load(true)
  }
  const stop = () => win.removeEventListener('keydown', onKey, true)

  if (!options.siteKey) return stop
  if (options.preview || parent === '' || editor) load()
  else if (options.siteId) {
    if (suggesting(win)) load()
    else if (key) win.addEventListener('keydown', onKey, true)
  }
  return stop
}
