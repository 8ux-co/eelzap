import type {
  CommonRequestOptions,
  DeleteOptions,
  Pagination,
  PreviewOption,
  QueryPrimitive,
  Seo,
  SeoInput,
  ItemMeta,
} from './common'
import type { CollectionSummary } from './collections'

/**
 * Operators supported by item filters.
 */
export interface FilterOperatorMap {
  eq?: QueryPrimitive
  ne?: QueryPrimitive
  gt?: QueryPrimitive
  gte?: QueryPrimitive
  lt?: QueryPrimitive
  lte?: QueryPrimitive
  in?: QueryPrimitive[] | string
  contains?: string
}

/**
 * Single filter value accepted by the SDK.
 */
export type FilterValue = QueryPrimitive | FilterOperatorMap

/**
 * Item list filter object keyed by field name.
 */
export type ItemFilters = Record<string, FilterValue>

/**
 * Options for the item list endpoint.
 */
export interface ItemListOptions extends CommonRequestOptions, PreviewOption {
  page?: number
  pageSize?: number
  sort?: string
  filter?: ItemFilters
}

/**
 * Options for the item detail endpoint.
 */
export type ItemGetOptions = CommonRequestOptions & PreviewOption

/**
 * Single item payload.
 */
export interface ItemDetail<TContent = Record<string, unknown>> {
  slug: string
  status: string
  locale: string
  localizedSlugs: Record<string, string>
  meta: ItemMeta
  content: TContent
  seo: Seo | null
  collection: { key: string; name: string }
}

/**
 * Item list response payload.
 */
export interface ItemListResponse<TContent = Record<string, unknown>> {
  data: ItemDetail<TContent>[]
  pagination: Pagination
  collection: CollectionSummary
}

/**
 * Input for creating a collection item.
 */
export interface CreateItemInput {
  slug: string
  locale?: string
  values: Record<string, unknown>
}

/**
 * Input for updating a collection item.
 */
export interface UpdateItemInput {
  slug?: string
  locale?: string
  values?: Record<string, unknown>
}

/**
 * Response payload for item mutation routes.
 */
export interface ItemMutationResponse<TContent = Record<string, unknown>> {
  item: ItemDetail<TContent>
}

/**
 * Response payload for item delete routes.
 */
export interface ItemDeleteResponse {
  success: true
}

/**
 * Extra options for item deletion.
 */
export type DeleteItemOptions = DeleteOptions

/**
 * SEO payload for item management routes.
 */
export type ItemSeo = Seo | SeoInput | Record<string, unknown> | null

/**
 * Response payload for item SEO routes.
 */
export interface ItemSeoResponse {
  seo: ItemSeo
}
