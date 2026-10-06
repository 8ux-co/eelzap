/**
 * Content versioning: the shapes the `…/versions` routes of the public API
 * answer with. Field names are the API's (camelCase), and every date is an ISO
 * string.
 */

export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

/**
 * One row of an entry's history. What `list`, `createDraft`, `publishDraft`
 * and `rollback` answer with: no values.
 */
export interface VersionSummary {
  id: string
  number: number
  status: VersionStatus
  /** The account that made the version, or null for an API key or a deleted account. */
  createdById: string | null
  /** The author's display name, or null when the account is gone. */
  authorName: string | null
  authorAvatarUrl: string | null
  note: string | null
  /** Set when the version was produced by a rollback from that version number. */
  restoredFromVersionNumber: number | null
  createdAt: string
  publishedAt: string | null
}

export interface ItemVersionSummary extends VersionSummary {
  itemId: string
  /** The item's default-locale slug as of this version. */
  slug: string | null
}

export interface DocumentVersionSummary extends VersionSummary {
  documentId: string
}

export interface VersionGalleryItem {
  id: string
  mediaId: string
  position: number
  caption: string | null
  description: string | null
}

/**
 * A stored value in a version snapshot. It is the raw column form, not the
 * delivery API's resolved value: one `value*` column is set according to
 * `fieldType`. `fieldKey` and `fieldType` are copies, so a version still reads
 * correctly after the field it came from was deleted.
 */
export interface VersionValue {
  id: string
  fieldKey: string | null
  fieldType: string | null
  locale: string | null
  valueText: string | null
  valueNumber: number | null
  valueInt: number | null
  valueBool: boolean | null
  valueDate: string | null
  valueDateTime: string | null
  valueAmountMinor: number | null
  valueCurrency: string | null
  valueEnumOptionId: string | null
  valueMediaId: string | null
  /** Present only on GALLERY values. */
  galleryItems?: VersionGalleryItem[]
}

export interface ItemVersionValue extends VersionValue {
  itemVersionId: string
  fieldId: string | null
}

export interface DocumentVersionValue extends VersionValue {
  documentVersionId: string
  documentFieldId: string | null
}

/** SEO as stored in a version snapshot, one row per locale. */
export interface VersionSeo {
  id: string
  locale: string | null
  metaTitle: string | null
  metaDescription: string | null
  ogType: string | null
  ogImageId: string | null
  ogImageAlt: string | null
  canonicalUrl: string | null
  twitterCard: string
  noIndex: boolean
  noFollow: boolean
  keywords: string | null
  structuredData: Record<string, unknown> | null
}

export interface ItemVersionSeo extends VersionSeo {
  itemVersionId: string
}

export interface DocumentVersionSeo extends VersionSeo {
  documentVersionId: string
}

export interface ItemVersionSlug {
  id: string
  itemVersionId: string
  locale: string
  slug: string
}

/**
 * One version with its snapshot. What `get` and `updateDraft` answer with.
 */
export interface VersionDetail extends VersionSummary {
  values: VersionValue[]
  seo: VersionSeo[]
}

export interface ItemVersionDetail extends ItemVersionSummary {
  values: ItemVersionValue[]
  seo: ItemVersionSeo[]
  slugs: ItemVersionSlug[]
}

export interface DocumentVersionDetail extends DocumentVersionSummary {
  values: DocumentVersionValue[]
  seo: DocumentVersionSeo[]
}

export interface VersionListResponse<TVersion extends VersionSummary = VersionSummary> {
  /** Newest first. */
  versions: TVersion[]
}

export interface CreateDraftInput {
  /** Up to 200 characters. */
  note?: string
}

export interface UpdateItemDraftInput {
  slug?: string
  locale?: string
  values?: Record<string, unknown>
}

export interface UpdateDocumentDraftInput {
  locale?: string
  values?: Record<string, unknown>
}
