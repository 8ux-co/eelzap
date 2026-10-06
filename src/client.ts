import { HttpClient } from './http'
import { CollectionsResource } from './resources/collections'
import { CommentsResource } from './resources/comments'
import { DocumentVersionsResource } from './resources/document-versions'
import { DocumentsResource } from './resources/documents'
import { ItemVersionsResource } from './resources/item-versions'
import { ItemsResource } from './resources/items'
import { MediaResource } from './resources/media'
import { PreviewTokensResource } from './resources/preview-tokens'
import { resolveRetry, type RetryOptions } from './retry'
import { SiteResource } from './resources/site'
import { SitesResource } from './resources/sites'
import type { ClientDefaults, DeliveryStatus } from './types/common'
import { isPreviewToken, maskApiKey, normalizeBaseUrl } from './utils'

export interface ClientConfig {
  /**
   * The bearer: a site API key (`secret_…` / `public_…`), or a preview token
   * (`zpt_…`) from a draft-mode URL — which turns `preview` on by default.
   */
  apiKey: string
  baseUrl?: string
  pathPrefix?: string
  locale?: string
  status?: DeliveryStatus
  /** Default for the item and document reads' `preview` option. */
  preview?: boolean
  fetch?: typeof globalThis.fetch
  defaultHeaders?: HeadersInit
  /** Per attempt, in ms. Default `30000`. */
  timeout?: number
  /**
   * Retries of a `429`, and of a `503` with `Retry-After`, honouring
   * `Retry-After` with exponential backoff and jitter. On by default for reads
   * and for writes that carry an `Idempotency-Key`; other writes are never
   * retried. `false` turns it off.
   */
  retry?: boolean | RetryOptions
}

/**
 * Main SDK client for the EelZap Content Delivery API.
 */
export class EelZapClient {
  readonly site: SiteResource
  readonly sites: SitesResource
  readonly collections: CollectionsResource
  readonly items: ItemsResource
  readonly documents: DocumentsResource
  readonly media: MediaResource
  readonly itemVersions: ItemVersionsResource
  readonly documentVersions: DocumentVersionsResource
  readonly previewTokens: PreviewTokensResource
  readonly comments: CommentsResource
  readonly #http: HttpClient
  readonly #defaults: ClientDefaults
  readonly #config: Required<Pick<ClientConfig, 'apiKey' | 'baseUrl' | 'pathPrefix' | 'timeout'>> &
    Pick<ClientConfig, 'defaultHeaders'>

  constructor(config: ClientConfig) {
    if (!config.apiKey.trim()) {
      throw new TypeError('apiKey is required.')
    }

    const fetchImpl = config.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('A fetch implementation is required.')
    }

    this.#defaults = {
      locale: config.locale,
      status: config.status,
      // A preview token only ever reads previews; say so on the wire too.
      preview: config.preview ?? (isPreviewToken(config.apiKey) || undefined),
    }

    this.#config = {
      apiKey: config.apiKey,
      baseUrl: normalizeBaseUrl(config.baseUrl ?? 'https://api.eelzap.com'),
      pathPrefix: config.pathPrefix ?? '/v1',
      defaultHeaders: config.defaultHeaders,
      timeout: config.timeout ?? 30_000,
    }

    this.#http = new HttpClient({
      apiKey: this.#config.apiKey,
      baseUrl: this.#config.baseUrl,
      pathPrefix: this.#config.pathPrefix,
      fetch: fetchImpl,
      defaultHeaders: this.#config.defaultHeaders,
      timeout: this.#config.timeout,
      retry: resolveRetry(config.retry),
    })

    this.site = new SiteResource(this.#http)
    this.sites = new SitesResource(this.#http)
    this.collections = new CollectionsResource(this.#http, this.#defaults)
    this.items = new ItemsResource(this.#http, this.#defaults)
    this.documents = new DocumentsResource(this.#http, this.#defaults)
    this.media = new MediaResource(this.#http)
    this.itemVersions = new ItemVersionsResource(this.#http)
    this.documentVersions = new DocumentVersionsResource(this.#http)
    this.previewTokens = new PreviewTokensResource(this.#http)
    this.comments = new CommentsResource(this.#http)
  }

  /**
   * Returns a masked string representation safe for logs.
   */
  toString(): string {
    return `EelZapClient(baseUrl=${this.#config.baseUrl}, pathPrefix=${this.#config.pathPrefix}, apiKey=${maskApiKey(this.#config.apiKey)})`
  }
}

/**
 * Creates a configured EelZap Delivery SDK client.
 */
export function createClient(config: ClientConfig): EelZapClient {
  return new EelZapClient(config)
}
