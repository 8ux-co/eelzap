import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type { DocumentValuesResponse } from '../types/documents'

/**
 * Document value management endpoints.
 */
export class DocumentValuesResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Gets all document values.
   */
  async get(documentKey: string): Promise<Record<string, unknown>> {
    const response = await this.#http.get<DocumentValuesResponse>(
      buildResourcePath('documents', documentKey, 'values'),
    )
    return response.values
  }

  /**
   * Updates document values by field key.
   */
  async update(
    documentKey: string,
    values: Record<string, unknown>,
    options?: { locale?: string },
  ): Promise<Record<string, unknown>> {
    const response = await this.#http.put<DocumentValuesResponse>(
      buildResourcePath('documents', documentKey, 'values'),
      {
        locale: options?.locale,
        values,
      },
    )
    return response.values
  }
}
