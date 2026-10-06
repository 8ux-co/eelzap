import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type { SeoInput } from '../types/common'
import type { DocumentSeo, DocumentSeoResponse } from '../types/documents'

/**
 * Document SEO management endpoints.
 */
export class DocumentSeoResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Gets SEO metadata for a document.
   */
  async get(documentKey: string, options?: { locale?: string }): Promise<DocumentSeo> {
    const response = await this.#http.get<DocumentSeoResponse>(
      buildResourcePath('documents', documentKey, 'seo'),
      {
        params: {
          locale: options?.locale,
        },
      },
    )
    return response.seo
  }

  /**
   * Updates SEO metadata for a document.
   */
  async update(documentKey: string, input: SeoInput): Promise<DocumentSeo> {
    const response = await this.#http.put<DocumentSeoResponse>(
      buildResourcePath('documents', documentKey, 'seo'),
      input,
    )
    return response.seo
  }
}
