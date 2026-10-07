/**
 * «Editar» and «Comentar» on the customer's site (zap-cms-v2 §3.4, ADR 041):
 * the constants and the context the core hands its two lazy chunks.
 *
 * Three pieces, so an ordinary visitor downloads nothing beyond the core:
 *
 * - the core (`boot.ts`, in the `./preview` budget): the opt-in trigger
 *   (`?zap` in the URL, or Shift Z), the OAuth callback relay on `{origin}/`,
 *   and the loader;
 * - `signin` (loaded only on the trigger): the launcher, «Entrar con Eel», PKCE,
 *   the popup or full-page redirect and the code exchange at Nest;
 * - `suggest` (loaded only after sign-in; the name is the file's, kept): the
 *   toolbar, Navegar, Editar and Comentar, the composer, the numbered pins
 *   and the calls to Zap.
 *
 * No directive, no imports: pure values both chunks and the core share.
 */

/** Nest, the suite's OAuth issuer (ADR 024). Compiled in; `authOrigin` is the dev opt-in. */
export const NEST_PRODUCTION_ORIGIN = 'https://auth.eel.software'

/**
 * The scope a site client asks for, by name (ADR 041 §2). `zap:preview:read`
 * is not asked for until a «Ver borradores» feature needs it (Manager,
 * 2026-10-05); Nest would drop it anyway.
 */
export const SITE_CLIENT_SCOPE = 'zap:suggest:write'

/** The popup hands the code to the opener tab over this channel (same origin). */
export const SIGNIN_CHANNEL = 'eel-zap'

/** Every `state` this client mints starts with it, so a site's own `?code=` is never ours. */
export const STATE_PREFIX = 'zap1.'

/** sessionStorage only (ADR 041 §7): the token, and a pending full-page sign-in. */
export const TOKEN_STORAGE_KEY = 'eelzap:site-token'
export const PENDING_STORAGE_KEY = 'eelzap:signin'

export type ChunkName = 'signin' | 'suggest'

/** What a callback page carries back from Nest (`{origin}/?code&state&iss`). */
export interface CallbackParams {
  code: string
  state: string
  iss: string
}

export interface StartOptions {
  /**
   * signin: open the panel at once, and why (`expired` after a 401 or the
   * hour). suggest: `renewed` after a sign-in that followed an expiry, which
   * says «Sesión renovada» (board SitioRenovacion).
   */
  reason?: 'expired' | 'trigger' | 'renewed'
  /** signin: finish a full-page sign-in that landed on this page. */
  callback?: CallbackParams
  /**
   * signin: start signing in at once, as if «Entrar con Eel» was pressed.
   * Passed by «Volver a entrar» (the bar's expired state), inside its click, so
   * the popup is still allowed.
   */
  signIn?: boolean
}

export interface ChunkHandle {
  destroy(): void
}

export interface ChunkModule {
  start(ctx: SiteContext, options?: StartOptions): ChunkHandle
}

/** Everything a chunk needs, decided once by the core. */
export interface SiteContext {
  win: Window
  doc: Document
  /** The Zap site's id (`data-site-id`); names its OAuth client. */
  siteId: string
  /** Where Zap's API and the client's CIMD document live. */
  zapOrigin: string
  /** Nest, the issuer: `/oauth/authorize`, `/api/oauth/token`, and the `iss` to expect. */
  authOrigin: string
  /** `{zapOrigin}/oauth/clients/{siteId}.json` (ADR 041 §1). */
  clientId: string
  /** `{page origin}/`, exactly as the CIMD document lists it. */
  redirectUri: string
  locale: 'es' | 'en'
  /** The letter pressed with Shift to open the tools, for the launcher's hint; false when off. */
  shortcut: string | false
  /**
   * The site's draft-mode route (`/api/zap-preview` by default), as the page
   * announced it: «Editar» enters draft mode through it on an untagged page
   * (`draft-session.ts`). Null or absent when the site has none.
   */
  draftRoute?: string | null
  /** Replace whatever chunk is showing with `name`. */
  open(name: ChunkName, options?: StartOptions): Promise<void>
  /** Close the showing chunk; the trigger works again. */
  close(): void
}

/** The client id of one site, the same string `@eel/api-keys` `zapSiteClientId` builds. */
export function siteClientId(zapOrigin: string, siteId: string): string {
  return `${zapOrigin}/oauth/clients/${siteId.toLowerCase()}.json`
}
