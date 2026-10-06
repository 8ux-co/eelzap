import type {
  CollectionDetail,
  CollectionListResponse,
  CreateCollectionInput,
  UpdateCollectionInput,
} from '../types/collections'
import type {
  ClientDefaults,
  DeleteOptions,
  DeliveryStatus,
  IdempotencyOptions,
} from '../types/common'
import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import { CollectionFieldsResource } from './collection-fields'
import { CollectionSectionsResource } from './collection-sections'
import { idempotent, toDeleteBody } from './resource-helpers'

/**
 * Read-only collection endpoints.
 */
export class CollectionsResource {
  readonly fields: CollectionFieldsResource
  readonly sections: CollectionSectionsResource
  readonly #http: HttpClient
  readonly #defaults: ClientDefaults

  /**
   * @internal
   */
  constructor(http: HttpClient, defaults: ClientDefaults) {
    this.#http = http
    this.#defaults = defaults
    this.fields = new CollectionFieldsResource(http)
    this.sections = new CollectionSectionsResource(http)
  }

  /**
   * Lists all collections available to the current API key.
   */
  async list(options?: { status?: DeliveryStatus }): Promise<CollectionListResponse> {
    return this.#http.get<CollectionListResponse>(buildResourcePath('collections'), {
      params: {
        status: options?.status ?? this.#defaults.status,
      },
    })
  }

  /**
   * Retrieves the schema for a single collection.
   */
  async get(
    collectionKey: string,
    options?: { status?: DeliveryStatus },
  ): Promise<CollectionDetail> {
    return this.#http.get<CollectionDetail>(buildResourcePath('collections', collectionKey), {
      params: {
        status: options?.status ?? this.#defaults.status,
      },
    })
  }

  /**
   * Creates a collection.
   *
   * Sends an `Idempotency-Key` (required of suite bearers): a fresh one per
   * call, or `options.idempotencyKey` to make your own retry safe.
   */
  async create(
    input: CreateCollectionInput,
    options?: IdempotencyOptions,
  ): Promise<CollectionDetail> {
    const response = await this.#http.post<{ collection: CollectionDetail }>(
      buildResourcePath('collections'),
      input,
      idempotent(options),
    )
    return response.collection
  }

  /**
   * Updates a collection.
   */
  async update(collectionKey: string, input: UpdateCollectionInput): Promise<CollectionDetail> {
    const response = await this.#http.patch<{ collection: CollectionDetail }>(
      buildResourcePath('collections', collectionKey),
      input,
    )
    return response.collection
  }

  /**
   * Deletes a collection.
   */
  async delete(collectionKey: string, options?: DeleteOptions): Promise<{ success: true }> {
    return this.#http.delete<{ success: true }>(
      buildResourcePath('collections', collectionKey),
      toDeleteBody(options),
    )
  }
}
