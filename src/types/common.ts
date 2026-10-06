/**
 * Supported delivery status filters.
 */
export type DeliveryStatus = 'published' | 'draft' | 'all'

/**
 * A primitive value accepted in query parameters.
 */
export type QueryPrimitive = string | number | boolean

/**
 * Pagination metadata returned by list endpoints.
 */
export interface Pagination {
  page: number
  pageSize: number
  pageCount: number
  total: number
}

export type JsonObject = {
  [key: string]: string | number | boolean | null | JsonObject | JsonObject[]
}

/**
 * Site metadata resolved from the authenticated API key.
 */
export interface SiteInfo {
  id: string
  name: string
  key: string
  /** The site's address (https; http only on a development host); null until set. */
  url?: string | null
  defaultLocale: string
  locales: string[]
  /**
   * «Otros dominios»: origins beyond `url`'s own where drafts may be shown
   * (a staging host, `http://localhost:3000`). Answered by `GET /site`.
   */
  previewOrigins?: string[]
  createdAt: string
  updatedAt: string
}

/**
 * `site.update()`: where the site lives. Send at least one. Needs a `secret_`
 * key, or a suite credential with `zap:schema:write` and an ADMIN seat.
 */
export interface UpdateSiteInput {
  /** https, or http on a development host such as `localhost`; `null` clears it. */
  url?: string | null
  /**
   * Replaces the stored list. Each entry is an origin: https, or
   * `http://localhost` / `http://127.0.0.1` with any port; never a Zap or
   * `eel.software` host. Normalised to its origin and deduplicated.
   */
  previewOrigins?: string[]
}

/**
 * One of the workspace's sites (`GET /sites`): `GET /site`'s body plus `url`.
 * Its `key` or its `id` is a valid `X-Eel-Site` for every other route.
 */
export interface SiteListEntry extends SiteInfo {
  url: string | null
}

/**
 * `GET /preview/token`: the preview token is live and was minted for the site
 * the given site API key belongs to.
 */
export interface PreviewTokenValidation {
  site: { key: string }
  /** ISO 8601: when the token stops working. */
  expiresAt?: string
}

/**
 * SEO metadata resolved for the current locale.
 */
export interface SeoImage {
  url: string
  alt: string | null
  width: number | null
  height: number | null
  type: string | null
}

/**
 * SEO metadata resolved for the current locale.
 */
export interface Seo {
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  ogUrl: string | null
  ogType: string | null
  ogLocale: string
  ogImage: SeoImage | null
  articlePublishedTime: string | null
  articleModifiedTime: string | null
  twitterCard: string
  noIndex: boolean
  noFollow: boolean
  keywords: string | null
  structuredData: JsonObject | null
}

/**
 * Collection item timestamps.
 */
export interface ItemMeta {
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

/**
 * Document timestamps.
 */
export interface DocumentMeta {
  updatedAt: string
  publishedAt: string | null
}

/**
 * Section metadata embedded in sectioned content groups.
 */
export interface SectionMeta {
  name: string
  key: string
}

/**
 * Enum values returned by the API.
 */
export interface EnumValue {
  value: string
  label: string
}

/**
 * A CURRENCY field's value, read and written in this one shape.
 *
 * `amountMinor` is in the currency's minor unit (cents: `4800000` is
 * COP 48.000,00), an integer. `currency` is the ISO 4217 code.
 */
export interface CurrencyValue {
  amountMinor: number
  currency: string
}

/**
 * Access mode for a media value.
 */
export type MediaAccess = 'public' | 'signed' | 'none'

/**
 * Media value returned by the delivery API.
 */
export interface MediaValue {
  id: string
  filename: string
  type: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  alt: string | null
  title: string | null
  description: string | null
  status: string
  mediaAccess: MediaAccess
  url: string | null
  signedUrl: string | null
  signedUrlExpiresAt: string | null
}

/**
 * Gallery entry values returned by the API.
 */
export interface GalleryItemValue {
  position: number
  caption: string | null
  description: string | null
  media: MediaValue | null
}

/**
 * Shared request options supported by most endpoints.
 */
export interface CommonRequestOptions {
  locale?: string
  status?: DeliveryStatus
  fields?: string[]
}

/**
 * JSON error payload returned by the delivery API.
 */
export interface ApiErrorPayload {
  error: {
    code: string
    message: string
    status: number
    /** Per-field problems on a validation refusal. */
    details?: ApiErrorDetail[]
  }
}

/**
 * One problem in a validation refusal: where, what, and the rule's code.
 */
export interface ApiErrorDetail {
  path: string
  message: string
  code: string
}

/**
 * Client-level defaults applied to every request unless overridden.
 */
export interface ClientDefaults {
  locale?: string
  status?: DeliveryStatus
  preview?: boolean
}

/**
 * Draft preview for the item and document reads.
 */
export interface PreviewOption {
  /**
   * Sends `preview=1`: every entry is returned whatever its status, and an entry
   * with an unpublished draft comes back with the draft's content. Responses
   * are `private, no-store`, and `cachedFetch` never stores them. Needs a
   * secret key that can read drafts, a preview token (`zpt_…`), or a suite
   * bearer with `zap:content:read` or `zap:preview:read`; a public key is
   * refused with `DRAFT_ACCESS_DENIED`.
   */
  preview?: boolean
  /**
   * Only matters with `preview`: `false` sends `stega=0`, which turns off the
   * invisible stega markers a preview response carries on prose fields (TEXT,
   * LONG_TEXT, the last text node of each RICH_TEXT block) for this one
   * request. Use it for server code that compares or keys on text, `<title>`
   * and meta tags. Without `preview` a response never carries markers and
   * nothing is sent.
   */
  stega?: boolean
}

/**
 * SEO input accepted by the public write API.
 */
export interface SeoInput {
  metaTitle?: string | null
  metaDescription?: string | null
  ogType?: string | null
  ogImageId?: string | null
  ogImageAlt?: string | null
  canonicalUrl?: string | null
  twitterCard?: 'SUMMARY' | 'SUMMARY_LARGE_IMAGE'
  noIndex?: boolean
  noFollow?: boolean
  keywords?: string | null
  structuredData?: JsonObject | null
  locale?: string
}

/**
 * Delete operations can optionally remove linked media.
 */
export interface DeleteOptions {
  deleteMediaIds?: string[]
}

/** Options of a write the API deduplicates by `Idempotency-Key`. */
export interface IdempotencyOptions {
  /** Defaults to a fresh random key per call; pass your own to make retries safe. */
  idempotencyKey?: string
}
