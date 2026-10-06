import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type { SiteInfo, UpdateSiteInput } from '../types/common'

/**
 * The site the API key belongs to: read it, and set where it lives.
 */
export class SiteResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Resolves the current site from the authenticated API key.
   */
  async get(): Promise<SiteInfo> {
    return this.#http.get<SiteInfo>(buildResourcePath('site'))
  }

  /**
   * Sets the site's URL and «Otros dominios» (`PATCH /site`), under the same
   * rules as the site's settings page, and resolves to the updated site.
   * Server code only: it needs a `secret_` key or an ADMIN suite credential.
   */
  async update(input: UpdateSiteInput): Promise<SiteInfo> {
    return this.#http.patch<SiteInfo>(buildResourcePath('site'), input)
  }
}
