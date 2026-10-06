import { HttpClient } from '../http'
import type { SiteListEntry } from '../types/common'

/**
 * The credential's workspace's sites.
 */
export class SitesResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Lists the workspace's sites, newest first. Each one's `key` or `id` is a
   * valid `X-Eel-Site` for every other call; this is how a suite client
   * learns which sites it can address.
   *
   * `GET /sites`. Suite bearer only (`eel_sk_` / `eel_at_`), `zap:sites:read`;
   * needs no `X-Eel-Site`. Site keys are refused: a site key is one site.
   */
  async list(): Promise<SiteListEntry[]> {
    const response = await this.#http.get<{ sites: SiteListEntry[] }>('/sites')
    return response.sites
  }
}
