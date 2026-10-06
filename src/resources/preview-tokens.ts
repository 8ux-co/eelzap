import { HttpClient } from '../http'
import type { PreviewTokenValidation } from '../types/common'

/**
 * Preview tokens (`zpt_…`, zap-cms-v2 §3.5): ten minutes, one site, read-only.
 */
export class PreviewTokensResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Checks that the client's preview token is live AND was minted for the
   * site `siteApiKey` belongs to, before trusting it (what a draft-mode route
   * does before turning draft mode on). Rejects with `EelZapError` 401 for an
   * unknown, revoked or expired token, 403 `WRONG_SITE` for another site's.
   *
   * `GET /preview/token`. The client's `apiKey` must be the `zpt_` token
   * itself (any other bearer is 403); `siteApiKey` is one of the site's own
   * API keys (public or secret), sent as `X-Zap-Site-Api-Key`.
   *
   * @example
   * ```ts
   * const zap = createClient({ apiKey: token })
   * const { site, expiresAt } = await zap.previewTokens.validate(process.env.ZAP_PUBLIC_KEY!)
   * ```
   */
  async validate(siteApiKey: string): Promise<PreviewTokenValidation> {
    return this.#http.get<PreviewTokenValidation>('/preview/token', {
      headers: { 'X-Zap-Site-Api-Key': siteApiKey },
    })
  }
}
