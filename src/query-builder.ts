import { HttpClient } from './http'
import type { ClientDefaults } from './types/common'
import type { FilterValue, ItemDetail, ItemListOptions, ItemListResponse } from './types/items'
import { ItemsResource } from './resources/items'

/**
 * Lazy fluent query builder for item list requests.
 */
export class ItemQueryBuilder {
  readonly #http: HttpClient
  readonly #defaults: ClientDefaults
  readonly #collectionKey: string
  readonly #options: ItemListOptions

  /**
   * @internal
   */
  constructor(
    http: HttpClient,
    defaults: ClientDefaults,
    collectionKey: string,
    options: ItemListOptions = {},
  ) {
    this.#http = http
    this.#defaults = defaults
    this.#collectionKey = collectionKey
    this.#options = options
  }

  /**
   * Overrides the request locale.
   */
  locale(locale: string): ItemQueryBuilder {
    return this.clone({ locale })
  }

  /**
   * Overrides the delivery status filter.
   */
  status(status: NonNullable<ItemListOptions['status']>): ItemQueryBuilder {
    return this.clone({ status })
  }

  /**
   * Adds or replaces a field filter.
   */
  filter(field: string, value: FilterValue): ItemQueryBuilder {
    return this.clone({
      filter: {
        ...(this.#options.filter ?? {}),
        [field]: value,
      },
    })
  }

  /**
   * Sets the sort expression.
   */
  sort(sort: string): ItemQueryBuilder {
    return this.clone({ sort })
  }

  /**
   * Selects a sparse set of content fields.
   */
  fields(fields: string[]): ItemQueryBuilder {
    return this.clone({ fields })
  }

  /**
   * Sets the current page.
   */
  page(page: number): ItemQueryBuilder {
    return this.clone({ page })
  }

  /**
   * Sets the page size.
   */
  pageSize(pageSize: number): ItemQueryBuilder {
    return this.clone({ pageSize })
  }

  /**
   * Executes the built request.
   */
  async get<TContent = Record<string, unknown>>(): Promise<ItemListResponse<TContent>> {
    const resource = new ItemsResource(this.#http, this.#defaults)
    return resource.list<TContent>(this.#collectionKey, this.#options)
  }

  /**
   * Returns the current request options as a plain object.
   */
  toJSON(): ItemListOptions {
    return {
      ...this.#options,
      filter: this.#options.filter ? { ...this.#options.filter } : undefined,
      fields: this.#options.fields ? [...this.#options.fields] : undefined,
    }
  }

  private clone(partial: Partial<ItemListOptions>): ItemQueryBuilder {
    return new ItemQueryBuilder(this.#http, this.#defaults, this.#collectionKey, {
      ...this.#options,
      ...partial,
    })
  }
}

export type { ItemDetail }
