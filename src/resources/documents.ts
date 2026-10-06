import { HttpClient } from '../http'
import type { ClientDefaults, IdempotencyOptions } from '../types/common'
import type {
  CreateDocumentInput,
  DeleteDocumentOptions,
  DocumentDetail,
  DocumentGetOptions,
  DocumentListOptions,
  DocumentListResponse,
  UpdateDocumentInput,
} from '../types/documents'
import { buildResourcePath } from '../paths'
import { DocumentFieldsResource } from './document-fields'
import { DocumentSectionsResource } from './document-sections'
import { DocumentSeoResource } from './document-seo'
import { DocumentValuesResource } from './document-values'
import { idempotent, toDeleteBody } from './resource-helpers'
import { mergeRequestOptions, previewParam, toArrayParam } from '../utils'

/**
 * Read-only document endpoints.
 */
export class DocumentsResource {
  readonly fields: DocumentFieldsResource
  readonly sections: DocumentSectionsResource
  readonly values: DocumentValuesResource
  readonly seo: DocumentSeoResource
  readonly #http: HttpClient
  readonly #defaults: ClientDefaults

  /**
   * @internal
   */
  constructor(http: HttpClient, defaults: ClientDefaults) {
    this.#http = http
    this.#defaults = defaults
    this.fields = new DocumentFieldsResource(http)
    this.sections = new DocumentSectionsResource(http)
    this.values = new DocumentValuesResource(http)
    this.seo = new DocumentSeoResource(http)
  }

  /**
   * Lists all documents available to the current API key.
   */
  async list(options?: DocumentListOptions): Promise<DocumentListResponse> {
    const merged = mergeRequestOptions(this.#defaults, options)

    return this.#http.get<DocumentListResponse>(buildResourcePath('documents'), {
      params: {
        locale: merged.locale,
        status: merged.status,
        ...previewParam(merged),
      },
    })
  }

  /**
   * Retrieves a single document by key.
   */
  async get<TContent = Record<string, unknown>>(
    documentKey: string,
    options?: DocumentGetOptions,
  ): Promise<DocumentDetail<TContent>> {
    const merged = mergeRequestOptions(this.#defaults, options)

    return this.#http.get<DocumentDetail<TContent>>(buildResourcePath('documents', documentKey), {
      params: {
        locale: merged.locale,
        status: merged.status,
        fields: toArrayParam(merged.fields),
        ...previewParam(merged),
      },
    })
  }

  /**
   * Creates a document.
   *
   * Sends an `Idempotency-Key` (required of suite bearers): a fresh one per
   * call, or `options.idempotencyKey` to make your own retry safe.
   */
  async create<TContent = Record<string, unknown>>(
    input: CreateDocumentInput,
    options?: IdempotencyOptions,
  ): Promise<DocumentDetail<TContent>> {
    const response = await this.#http.post<{ document: DocumentDetail<TContent> }>(
      buildResourcePath('documents'),
      input,
      idempotent(options),
    )
    return response.document
  }

  /**
   * Updates a document.
   */
  async update<TContent = Record<string, unknown>>(
    documentKey: string,
    input: UpdateDocumentInput,
  ): Promise<DocumentDetail<TContent>> {
    const response = await this.#http.patch<{ document: DocumentDetail<TContent> }>(
      buildResourcePath('documents', documentKey),
      input,
    )
    return response.document
  }

  /**
   * Deletes a document.
   */
  async delete(documentKey: string, options?: DeleteDocumentOptions): Promise<{ success: true }> {
    return this.#http.delete<{ success: true }>(
      buildResourcePath('documents', documentKey),
      toDeleteBody(options),
    )
  }

  /**
   * Publishes a document.
   */
  async publish<TContent = Record<string, unknown>>(
    documentKey: string,
  ): Promise<DocumentDetail<TContent>> {
    const response = await this.#http.post<{ document: DocumentDetail<TContent> }>(
      buildResourcePath('documents', documentKey, 'publish'),
    )
    return response.document
  }

  /**
   * Unpublishes a document.
   */
  async unpublish<TContent = Record<string, unknown>>(
    documentKey: string,
  ): Promise<DocumentDetail<TContent>> {
    const response = await this.#http.post<{ document: DocumentDetail<TContent> }>(
      buildResourcePath('documents', documentKey, 'unpublish'),
    )
    return response.document
  }
}
