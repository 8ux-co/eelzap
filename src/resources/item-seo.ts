import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type { SeoInput } from '../types/common'
import type { ItemSeo, ItemSeoResponse } from '../types/items'

/**
 * Item SEO management endpoints.
 */
export class ItemSeoResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Gets SEO metadata for an item.
   */
  async get(collectionKey: string, slug: string, options?: { locale?: string }): Promise<ItemSeo> {
    const response = await this.#http.get<ItemSeoResponse>(
      buildResourcePath('collections', collectionKey, 'items', slug, 'seo'),
      {
        params: {
          locale: options?.locale,
        },
      },
    )
    return response.seo
  }

  /**
   * Updates SEO metadata for an item.
   */
  async update(collectionKey: string, slug: string, input: SeoInput): Promise<ItemSeo> {
    const response = await this.#http.patch<ItemSeoResponse>(
      buildResourcePath('collections', collectionKey, 'items', slug, 'seo'),
      input,
    )
    return response.seo
  }
}
