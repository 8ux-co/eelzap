import {
  getPreviewToken,
  initZap,
  onValues,
  previewHeaders,
  ZAP_PREVIEW_TOKEN_HEADER,
} from './live'

/**
 * The script-tag build of the Live client (`v1.<hash>.js`, served immutably by
 * Zap at `/js/preview/`, zap-cms-v2 §2.7), for sites without a bundler:
 *
 * ```html
 * <script src="https://zap.eel.software/js/preview/v1.<hash>.js"
 *   integrity="sha384-…" crossorigin="anonymous"
 *   data-site="verdeorigen" data-site-id="…uuid…" async></script>
 * ```
 *
 * `data-site` is the site key; `data-site-id` the site's id, which turns on
 * «Editar» and «Comentar» on the live site (§3.4); `data-zap-shortcut` the letter
 * pressed with Shift to open them, `Z` by default (`off` for none); `data-zap-draft-route` the site's draft-mode
 * route path (§2.5); `data-zap-open` (set by the boot when it saw the
 * shortcut) opens suggestion mode at once; `data-zap-origin` and `data-auth-origin` are the
 * development opt-ins (`live.ts`, "Development"). The suggestion chunks load
 * from beside this file (`site/load-cdn.ts`). The API is on `window.EelZap` for `onValues`
 * and the cookieless fallback (`previewHeaders`); it is frozen so a site script
 * cannot swap a function under another; a second copy of this file finds it
 * there and starts nothing. Tags are written by hand without a
 * bundler (`data-zap="blog/hola#cover"`), and `cleanStega` is a server-side
 * concern, so neither ships here.
 */
const script = document.currentScript
const siteKey = script?.getAttribute('data-site')
const attr = (name: string) => script?.getAttribute(name) ?? undefined
// A second copy of this file on the page (two tags, a boot that ran twice)
// finds the first one's API and starts nothing: one overlay per page.
const first = !('EelZap' in window)
if (siteKey && first) {
  const shortcut = attr('data-zap-shortcut')
  initZap({
    siteKey,
    siteId: attr('data-site-id'),
    zapOrigin: attr('data-zap-origin'),
    authOrigin: attr('data-auth-origin'),
    shortcut: shortcut === 'off' ? false : shortcut,
    chunkBase: (script as HTMLScriptElement | null)?.src || null,
    draftRoute: attr('data-zap-draft-route'),
    open: script?.hasAttribute('data-zap-open'),
  })
}
const api = Object.freeze({
  initZap,
  onValues,
  getPreviewToken,
  previewHeaders,
  previewTokenHeader: ZAP_PREVIEW_TOKEN_HEADER,
})
try {
  Object.defineProperty(window, 'EelZap', { value: api, configurable: false, writable: false })
} catch {
  // Already defined (a second copy of the tag): the first one stays in charge.
}
