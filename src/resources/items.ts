import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import { ItemQueryBuilder } from '../query-builder'
import type { ClientDefaults, IdempotencyOptions } from '../types/common'
import type {
  CreateItemInput,
  DeleteItemOptions,
  ItemDetail,
  ItemGetOptions,
  ItemListOptions,
  ItemListResponse,
  UpdateItemInput,
} from '../types/items'
import { mergeRequestOptions, previewParam, serializeFilters, toArrayParam } from '../utils'
import { ItemSeoResource } from './item-seo'
import { idempotent, toDeleteBody } from './resource-helpers'

/**
 * Read-only collection item endpoints.
 */
export class ItemsResource {
  readonly seo: ItemSeoResource
  readonly #http: HttpClient
  readonly #defaults: ClientDefaults

  /**
   * @internal
   */
  constructor(http: HttpClient, defaults: ClientDefaults) {
    this.#http = http
    this.#defaults = defaults
    this.seo = new ItemSeoResource(http)
  }

  /**
   * Lists items in a collection.
   */
  async list<TContent = Record<string, unknown>>(
    collectionKey: string,
    options?: ItemListOptions,
  ): Promise<ItemListResponse<TContent>> {
    const merged = mergeRequestOptions(this.#defaults, options)

    return this.#http.get<ItemListResponse<TContent>>(
      buildResourcePath('collections', collectionKey, 'items'),
      {
        params: {
          locale: merged.locale,
          status: merged.status,
          fields: toArrayParam(merged.fields),
          page: merged.page,
          pageSize: merged.pageSize,
          sort: merged.sort,
          ...serializeFilters(merged.filter),
          ...previewParam(merged),
        },
      },
    )
  }

  /**
   * Retrieves a single item by slug.
   */
  async get<TContent = Record<string, unknown>>(
    collectionKey: string,
    slug: string,
    options?: ItemGetOptions,
  ): Promise<ItemDetail<TContent>> {
    const merged = mergeRequestOptions(this.#defaults, options)

    return this.#http.get<ItemDetail<TContent>>(
      buildResourcePath('collections', collectionKey, 'items', slug),
      {
        params: {
          locale: merged.locale,
          status: merged.status,
          fields: toArrayParam(merged.fields),
          ...previewParam(merged),
        },
      },
    )
  }

  /**
   * Starts a lazy fluent query builder for a collection.
   */
  collection(collectionKey: string): ItemQueryBuilder {
    return new ItemQueryBuilder(this.#http, this.#defaults, collectionKey)
  }

  /**
   * Creates an item in a collection.
   *
   * Sends an `Idempotency-Key` (required of suite bearers): a fresh one per
   * call, or `options.idempotencyKey` to make your own retry safe.
   */
  async create<TContent = Record<string, unknown>>(
    collectionKey: string,
    input: CreateItemInput,
    options?: IdempotencyOptions,
  ): Promise<ItemDetail<TContent>> {
    const response = await this.#http.post<{ item: ItemDetail<TContent> }>(
      buildResourcePath('collections', collectionKey, 'items'),
      input,
      idempotent(options),
    )
    return response.item
  }

  /**
   * Updates an item by slug.
   */
  async update<TContent = Record<string, unknown>>(
    collectionKey: string,
    slug: string,
    input: UpdateItemInput,
  ): Promise<ItemDetail<TContent>> {
    const response = await this.#http.patch<{ item: ItemDetail<TContent> }>(
      buildResourcePath('collections', collectionKey, 'items', slug),
      input,
    )
    return response.item
  }

  /**
   * Deletes an item by slug.
   */
  async delete(
    collectionKey: string,
    slug: string,
    options?: DeleteItemOptions,
  ): Promise<{ success: true }> {
    return this.#http.delete<{ success: true }>(
      buildResourcePath('collections', collectionKey, 'items', slug),
      toDeleteBody(options),
    )
  }

  /**
   * Publishes an item by slug.
   */
  async publish<TContent = Record<string, unknown>>(
    collectionKey: string,
    slug: string,
  ): Promise<ItemDetail<TContent>> {
    const response = await this.#http.post<{ item: ItemDetail<TContent> }>(
      buildResourcePath('collections', collectionKey, 'items', slug, 'publish'),
    )
    return response.item
  }

  /**
   * Unpublishes an item by slug.
   */
  async unpublish<TContent = Record<string, unknown>>(
    collectionKey: string,
    slug: string,
  ): Promise<ItemDetail<TContent>> {
    const response = await this.#http.post<{ item: ItemDetail<TContent> }>(
      buildResourcePath('collections', collectionKey, 'items', slug, 'unpublish'),
    )
    return response.item
  }
}
