import { BOOT_ATTRIBUTES, bootZapPreview, type ZapBootOptions } from './boot'

/**
 * The script-tag boot (`boot.v1.<hash>.js` on Zap's CDN), for sites without a
 * bundler:
 *
 * ```html
 * <script src="https://zap.eel.software/js/preview/boot.v1.<hash>.js"
 *   integrity="sha384-…" crossorigin="anonymous"
 *   data-site="verdeorigen" data-site-id="…uuid…"
 *   data-zap-draft-route="/api/zap-preview" async></script>
 * ```
 *
 * The attributes are `BOOT_ATTRIBUTES`: `data-site`, `data-site-id`,
 * `data-zap-draft-route`, `data-zap-shortcut` (`off` for none), and the
 * development opt-ins `data-zap-origin` and `data-auth-origin`;
 * `data-zap-preview` marks a page the server rendered in draft mode.
 */
const script = document.currentScript
const options: Record<string, unknown> = { preview: !!script?.hasAttribute('data-zap-preview') }
let key: keyof typeof BOOT_ATTRIBUTES
for (key in BOOT_ATTRIBUTES) {
  options[key] = script?.getAttribute(`data-${BOOT_ATTRIBUTES[key]}`) ?? undefined
}
if (options.shortcut === 'off') options.shortcut = false
bootZapPreview(options as unknown as ZapBootOptions)
