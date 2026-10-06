import type { DeliveryStatus, Pagination } from './common'

/**
 * Media types supported by the public management API.
 */
export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'OTHER' | (string & {})

/**
 * Sort expressions supported by the media list route.
 */
export type MediaSort =
  | 'createdAt:desc'
  | 'createdAt:asc'
  | 'filename:asc'
  | 'filename:desc'
  | 'size:desc'
  | 'size:asc'

/**
 * Usage filter supported by the media list route.
 */
export type MediaUsage = 'all' | 'linked' | 'unlinked'

/**
 * Media list params accepted by the public API.
 */
export interface MediaListParams {
  search?: string
  page?: number
  pageSize?: number
  sort?: MediaSort
  type?: MediaType
  status?: Uppercase<DeliveryStatus> | DeliveryStatus
  usage?: MediaUsage
}

/**
 * Media payload returned by management routes.
 */
export interface MediaDetail {
  id: string
  filename?: string
  type: MediaType
  mimeType?: string
  contentType?: string
  size?: number
  width: number | null
  height: number | null
  alt?: string | null
  title?: string | null
  description?: string | null
  url: string | null
  status: string
  mediaAccess?: string
  signedUrl?: string | null
  signedUrlExpiresAt?: string | null
  createdAt?: string
  updatedAt?: string
}

/**
 * Response payload for media list routes.
 */
export interface MediaListResponse {
  items: MediaDetail[]
  page: number
  pageSize: number
  total?: number
  pageCount?: number
  pagination?: Pagination
}

/**
 * Response payload for a single media detail route.
 */
export type MediaDetailResponse = MediaDetail

/**
 * Input for updating media metadata.
 */
export interface UpdateMediaInput {
  alt?: string | null
  title?: string | null
  description?: string | null
}

/**
 * Input for `POST /media/from-url`: Zap downloads the file server-side.
 */
export interface MediaFromUrlInput {
  /** An absolute http(s) URL on port 80 or 443, at most 2048 characters. */
  url: string
  /** Defaults to the URL's last path segment. At most 255 characters. */
  filename?: string
  /** `''` or `null` mean none; at most 2000 characters. */
  title?: string | null
  alt?: string | null
}

/**
 * Input for requesting a presigned upload URL.
 */
export interface CreateUploadUrlInput {
  filename: string
  contentType: string
  size: number
  width?: number
  height?: number
}

/**
 * Response payload for the upload URL route.
 */
export interface UploadUrlResponse {
  uploadUrl: string
  mediaId: string
  key: string
}

/**
 * Input for confirming an upload.
 */
export interface ConfirmUploadInput {
  mediaId: string
  key: string
  filename: string
  contentType: string
  size: number
  width?: number
  height?: number
}

/**
 * Accepted binary sources for high-level uploads.
 */
export type UploadFile = ArrayBuffer | ArrayBufferView | Blob

/**
 * High-level media upload input.
 */
export interface MediaUploadInput {
  file: UploadFile
  filename: string
  contentType: string
  width?: number
  height?: number
  alt?: string | null
  title?: string | null
  description?: string | null
}
