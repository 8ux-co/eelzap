import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type {
  CollectionFieldListResponse,
  CreateFieldInput,
  FieldInfo,
  UpdateFieldInput,
} from '../types/collections'
import type { IdempotencyOptions } from '../types/common'
import { idempotent, normalizeFieldInput } from './resource-helpers'

/**
 * Collection field management endpoints.
 */
export class CollectionFieldsResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Lists all fields in a collection.
   */
  async list(collectionKey: string): Promise<FieldInfo[]> {
    const response = await this.#http.get<CollectionFieldListResponse>(
      buildResourcePath('collections', collectionKey, 'fields'),
    )
    return response.fields
  }

  /**
   * Creates a field in a collection.
   *
   * Sends an `Idempotency-Key` (required of suite bearers): a fresh one per
   * call, or `options.idempotencyKey` to make your own retry safe.
   */
  async create(
    collectionKey: string,
    input: CreateFieldInput,
    options?: IdempotencyOptions,
  ): Promise<FieldInfo> {
    const response = await this.#http.post<{ field: FieldInfo }>(
      buildResourcePath('collections', collectionKey, 'fields'),
      normalizeFieldInput(input),
      idempotent(options),
    )
    return response.field
  }

  /**
   * Updates a field in a collection.
   */
  async update(
    collectionKey: string,
    fieldId: string,
    input: UpdateFieldInput,
  ): Promise<FieldInfo> {
    const response = await this.#http.patch<{ field: FieldInfo }>(
      buildResourcePath('collections', collectionKey, 'fields', fieldId),
      normalizeFieldInput(input),
    )
    return response.field
  }

  /**
   * Deletes a field from a collection.
   */
  async delete(collectionKey: string, fieldId: string): Promise<{ success: true }> {
    return this.#http.delete<{ success: true }>(
      buildResourcePath('collections', collectionKey, 'fields', fieldId),
    )
  }

  /**
   * Lists the collection's archived (soft-deleted) fields, most recently
   * deleted first. Their values are kept, which is what makes `restore` work.
   *
   * `GET /collections/{collectionKey}/fields/deleted`. Secret key, or suite
   * bearer with `zap:content:read`.
   */
  async listDeleted(collectionKey: string): Promise<FieldInfo[]> {
    const response = await this.#http.get<CollectionFieldListResponse>(
      buildResourcePath('collections', collectionKey, 'fields', 'deleted'),
    )
    return response.fields
  }

  /**
   * Brings an archived field back with every value it held, at the end of the
   * root list (outside any section).
   *
   * `POST /collections/{collectionKey}/fields/{fieldId}/restore`. Secret key,
   * or suite bearer with `zap:schema:write` and the Zap ADMIN role.
   */
  async restore(collectionKey: string, fieldId: string): Promise<FieldInfo> {
    const response = await this.#http.post<{ field: FieldInfo }>(
      buildResourcePath('collections', collectionKey, 'fields', fieldId, 'restore'),
    )
    return response.field
  }

  /**
   * Reorders collection fields.
   */
  async reorder(collectionKey: string, fieldIds: string[]): Promise<{ success: true }> {
    return this.#http.put<{ success: true }>(
      buildResourcePath('collections', collectionKey, 'fields', 'reorder'),
      { fieldIds },
    )
  }
}
