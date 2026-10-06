/**
 * `@8ux-co/eelzap/preview` — the browser core (`.docs/proposals/zap-cms-v2.md`
 * §2.4–2.7): bridge protocol, tag index, overlay, value substitution,
 * sanitiser and anchors. Zero runtime dependencies, ES2020, browser only.
 *
 * Entries:
 * - `.`        this core: the Live client (`initZap`, `zapAttrs`, `onValues`,
 *              `cleanStega`, the cookieless preview token helpers), the page
 *              runtime it boots, and the protocol;
 * - `./react`  `useZapLiveUpdates`;
 * - `./next`   the draft-mode route helper and `getPreviewToken` (server);
 * - `./editor` the editor side of the bridge (Zap's preview panel).
 */
export {
  cleanStega,
  developmentZapOrigin,
  getPreviewToken,
  initZap,
  onValues,
  PREVIEW_TOKEN_STORAGE_KEY,
  previewHeaders,
  recordRefsOf,
  ZAP_PREVIEW_TOKEN_HEADER,
  ZAP_PRODUCTION_ORIGIN,
  zapAttrs,
  type EntryLike,
  type InitZapOptions,
  type ValuesHandler,
  type ZapLive,
} from './live'
export * from './protocol'
export {
  observeTags,
  readElementTag,
  TAG_SELECTOR,
  TagIndex,
  type ObserveOptions,
  type ReadTagResult,
  type TaggedElement,
  type TagProblem,
} from './tags'
export {
  isSafeImageUrl,
  isSafeSrcset,
  isSafeUrl,
  RICH_TEXT_ALLOWED_ATTRS,
  RICH_TEXT_ALLOWED_TAGS,
  RICH_TEXT_DROPPED_TAGS,
  richTextToText,
  sanitizeRichText,
  sanitizeRichTextToString,
} from './sanitize'
export { ValueApplier } from './values'
export {
  buildAnchor,
  buildDomAnchor,
  buildSelector,
  cssEscape,
  findAnchorElement,
  normalizeText,
  normalizedRect,
  safeQueryAll,
  textQuoteFor,
} from './anchor'
export { Overlay, OVERLAY_HOST_TAG, type OverlayCallbacks, type OverlayOptions } from './overlay'
export {
  createPageBridge,
  type MessageTargetLike,
  type PageBridge,
  type PageBridgeOptions,
} from './page-bridge'
export {
  CLIENT_VERSION,
  startRuntime,
  type PageRuntime,
  type RuntimeConfig,
  type RuntimeOptions,
} from './runtime'
