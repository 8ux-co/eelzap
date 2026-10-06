import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type {
  CreateDocumentFieldInput,
  DocumentFieldListResponse,
  UpdateDocumentFieldInput,
} from '../types/documents'
import type { FieldInfo } from '../types/collections'
import type { IdempotencyOptions } from '../types/common'
import { idempotent, normalizeFieldInput } from './resource-helpers'

/**
 * Document field management endpoints.
 */
export class DocumentFieldsResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Lists all fields in a document.
   */
  async list(documentKey: string): Promise<FieldInfo[]> {
    const response = await this.#http.get<DocumentFieldListResponse>(
      buildResourcePath('documents', documentKey, 'fields'),
    )
    return response.fields
  }

  /**
   * Gets a single field in a document.
   */
  async get(documentKey: string, fieldId: string): Promise<FieldInfo> {
    const response = await this.#http.get<{ field: FieldInfo }>(
      buildResourcePath('documents', documentKey, 'fields', fieldId),
    )
    return response.field
  }

  /**
   * Creates a field in a document.
   *
   * Sends an `Idempotency-Key` (required of suite bearers): a fresh one per
   * call, or `options.idempotencyKey` to make your own retry safe.
   */
  async create(
    documentKey: string,
    input: CreateDocumentFieldInput,
    options?: IdempotencyOptions,
  ): Promise<FieldInfo> {
    const response = await this.#http.post<{ field: FieldInfo }>(
      buildResourcePath('documents', documentKey, 'fields'),
      normalizeFieldInput(input),
      idempotent(options),
    )
    return response.field
  }

  /**
   * Updates a field in a document.
   */
  async update(
    documentKey: string,
    fieldId: string,
    input: UpdateDocumentFieldInput,
  ): Promise<FieldInfo> {
    const response = await this.#http.patch<{ field: FieldInfo }>(
      buildResourcePath('documents', documentKey, 'fields', fieldId),
      normalizeFieldInput(input),
    )
    return response.field
  }

  /**
   * Deletes a field from a document.
   */
  async delete(documentKey: string, fieldId: string): Promise<{ success: true }> {
    return this.#http.delete<{ success: true }>(
      buildResourcePath('documents', documentKey, 'fields', fieldId),
    )
  }

  /**
   * Lists the document's archived (soft-deleted) fields, most recently
   * deleted first. Their values are kept, which is what makes `restore` work.
   *
   * `GET /documents/{documentKey}/fields/deleted`. Secret key, or suite bearer
   * with `zap:content:read`.
   */
  async listDeleted(documentKey: string): Promise<FieldInfo[]> {
    const response = await this.#http.get<DocumentFieldListResponse>(
      buildResourcePath('documents', documentKey, 'fields', 'deleted'),
    )
    return response.fields
  }

  /**
   * Brings an archived field back with every value it held, at the end of the
   * root list (outside any section).
   *
   * `POST /documents/{documentKey}/fields/{fieldId}/restore`. Secret key, or
   * suite bearer with `zap:schema:write` and the Zap ADMIN role.
   */
  async restore(documentKey: string, fieldId: string): Promise<FieldInfo> {
    const response = await this.#http.post<{ field: FieldInfo }>(
      buildResourcePath('documents', documentKey, 'fields', fieldId, 'restore'),
    )
    return response.field
  }

  /**
   * Reorders document fields.
   */
  async reorder(documentKey: string, fieldIds: string[]): Promise<{ success: true }> {
    return this.#http.post<{ success: true }>(
      buildResourcePath('documents', documentKey, 'fields', 'reorder'),
      { fieldIds },
    )
  }
}
