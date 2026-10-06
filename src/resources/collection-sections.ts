import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type {
  CollectionSectionListResponse,
  CreateSectionInput,
  SectionInfo,
  UpdateSectionInput,
} from '../types/collections'
import type { IdempotencyOptions } from '../types/common'
import { idempotent } from './resource-helpers'

/**
 * Collection section management endpoints.
 */
export class CollectionSectionsResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Lists all sections in a collection.
   */
  async list(collectionKey: string): Promise<SectionInfo[]> {
    const response = await this.#http.get<CollectionSectionListResponse>(
      buildResourcePath('collections', collectionKey, 'sections'),
    )
    return response.sections
  }

  /**
   * Gets a single section from a collection.
   */
  async get(collectionKey: string, sectionId: string): Promise<SectionInfo> {
    const response = await this.#http.get<{ section: SectionInfo }>(
      buildResourcePath('collections', collectionKey, 'sections', sectionId),
    )
    return response.section
  }

  /**
   * Creates a section in a collection.
   *
   * Sends an `Idempotency-Key` (required of suite bearers): a fresh one per
   * call, or `options.idempotencyKey` to make your own retry safe.
   */
  async create(
    collectionKey: string,
    input: CreateSectionInput,
    options?: IdempotencyOptions,
  ): Promise<SectionInfo> {
    const response = await this.#http.post<{ section: SectionInfo }>(
      buildResourcePath('collections', collectionKey, 'sections'),
      input,
      idempotent(options),
    )
    return response.section
  }

  /**
   * Updates a section in a collection.
   */
  async update(
    collectionKey: string,
    sectionId: string,
    input: UpdateSectionInput,
  ): Promise<SectionInfo> {
    const response = await this.#http.patch<{ section: SectionInfo }>(
      buildResourcePath('collections', collectionKey, 'sections', sectionId),
      input,
    )
    return response.section
  }

  /**
   * Deletes a section from a collection.
   */
  async delete(collectionKey: string, sectionId: string): Promise<{ success: true }> {
    return this.#http.delete<{ success: true }>(
      buildResourcePath('collections', collectionKey, 'sections', sectionId),
    )
  }
}
