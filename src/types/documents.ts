import type {
  CommonRequestOptions,
  DeleteOptions,
  DocumentMeta,
  PreviewOption,
  Seo,
  SeoInput,
} from './common'
import type {
  CollectionFieldListResponse,
  CollectionSectionListResponse,
  CreateFieldInput,
  FieldInfo,
  SectionInfo,
  UpdateFieldInput,
} from './collections'

/**
 * Document list entry returned by the list endpoint.
 */
export interface DocumentListEntry {
  key: string
  name: string
  description: string | null
  status: string
  updatedAt: string
  publishedAt: string | null
  fields: FieldInfo[]
  sections: SectionInfo[]
}

/**
 * Document detail payload.
 */
export interface DocumentDetail<TContent = Record<string, unknown>> {
  key: string
  name: string
  status: string
  locale: string
  meta: DocumentMeta
  content: TContent
  seo: Seo | null
}

/**
 * Response shape for document lists.
 */
export interface DocumentListResponse {
  data: DocumentListEntry[]
}

/**
 * Options for listing documents.
 */
export type DocumentListOptions = Omit<CommonRequestOptions, 'fields'> & PreviewOption

/**
 * Options for retrieving a single document.
 */
export type DocumentGetOptions = CommonRequestOptions & PreviewOption

/**
 * Input for creating a document.
 */
export interface CreateDocumentInput {
  name: string
  key: string
  description?: string
}

/**
 * Input for updating a document.
 */
export interface UpdateDocumentInput {
  name?: string
  key?: string
  description?: string | null
  /**
   * «Ruta en tu sitio»: the page this document is — `/nosotros`,
   * `/{locale}/nosotros`. `''` or `null` clears it. Starts with `/`; only
   * `{locale}`.
   */
  previewPath?: string | null
}

/**
 * Response payload for document mutation routes.
 */
export interface DocumentMutationResponse<TContent = Record<string, unknown>> {
  document: DocumentDetail<TContent>
}

/**
 * Response payload for document delete routes.
 */
export interface DocumentDeleteResponse {
  success: true
}

/**
 * Extra options for document deletion.
 */
export type DeleteDocumentOptions = DeleteOptions

/**
 * Document field inputs mirror collection field inputs.
 */
export type CreateDocumentFieldInput = CreateFieldInput

/**
 * Document field update inputs mirror collection field inputs.
 */
export type UpdateDocumentFieldInput = UpdateFieldInput

/**
 * Response payload for document field list operations.
 */
export type DocumentFieldListResponse = CollectionFieldListResponse

/**
 * Response payload for document section list operations.
 */
export type DocumentSectionListResponse = CollectionSectionListResponse

/**
 * Response payload for document values routes.
 */
export interface DocumentValuesResponse {
  values: Record<string, unknown>
}

/**
 * SEO payload for document management routes.
 */
export type DocumentSeo = Seo | SeoInput | Record<string, unknown> | null

/**
 * Response payload for document SEO routes.
 */
export interface DocumentSeoResponse {
  seo: DocumentSeo
}
