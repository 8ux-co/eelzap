import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type { IdempotencyOptions } from '../types/common'
import { normalizeHeaderValue } from '../utils'
import { idempotent } from './resource-helpers'
import type {
  ConfirmUploadInput,
  CreateUploadUrlInput,
  MediaDetail,
  MediaFromUrlInput,
  MediaListParams,
  MediaListResponse,
  MediaUploadInput,
  UpdateMediaInput,
  UploadFile,
  UploadUrlResponse,
} from '../types/media'

function isBlobFile(file: UploadFile): file is Blob {
  return typeof Blob !== 'undefined' && file instanceof Blob
}

function toUploadBody(file: UploadFile): BodyInit {
  if (isBlobFile(file)) {
    return file
  }

  if (ArrayBuffer.isView(file)) {
    const bytes =
      file.buffer instanceof ArrayBuffer
        ? file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
        : new Uint8Array(file.buffer, file.byteOffset, file.byteLength).slice().buffer
    return new Blob([bytes])
  }

  return file
}

function getUploadSize(file: UploadFile): number {
  if (isBlobFile(file)) {
    return file.size
  }

  if (ArrayBuffer.isView(file)) {
    return file.byteLength
  }

  return file instanceof ArrayBuffer ? file.byteLength : 0
}

/**
 * Media management endpoints.
 */
export class MediaResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Lists media for the current site.
   */
  async list(params?: MediaListParams): Promise<MediaListResponse> {
    return this.#http.get<MediaListResponse>(buildResourcePath('media'), {
      params: {
        search: params?.search,
        page: params?.page,
        pageSize: params?.pageSize,
        sort: params?.sort,
        type: params?.type,
        status: params?.status,
        usage: params?.usage,
      },
    })
  }

  /**
   * Gets a single media item.
   */
  async get(id: string): Promise<MediaDetail> {
    return this.#http.get<MediaDetail>(buildResourcePath('media', id))
  }

  /**
   * Updates media metadata.
   */
  async update(id: string, input: UpdateMediaInput): Promise<MediaDetail> {
    const response = await this.#http.patch<{ media: MediaDetail }>(
      buildResourcePath('media', id),
      input,
    )
    return response.media
  }

  /**
   * Deletes media.
   */
  async delete(id: string): Promise<{ success: true }> {
    return this.#http.delete<{ success: true }>(buildResourcePath('media', id))
  }

  /**
   * Publishes media.
   */
  async publish(id: string): Promise<MediaDetail> {
    const response = await this.#http.post<{ media: MediaDetail }>(
      buildResourcePath('media', id, 'publish'),
    )
    return response.media
  }

  /**
   * Unpublishes media.
   */
  async unpublish(id: string): Promise<MediaDetail> {
    const response = await this.#http.post<{ media: MediaDetail }>(
      buildResourcePath('media', id, 'unpublish'),
    )
    return response.media
  }

  /**
   * Requests a presigned upload URL.
   */
  async createUploadUrl(input: CreateUploadUrlInput): Promise<UploadUrlResponse> {
    return this.#http.post<UploadUrlResponse>(buildResourcePath('media', 'upload-url'), input)
  }

  /**
   * Confirms a completed upload.
   */
  async confirmUpload(input: ConfirmUploadInput): Promise<MediaDetail> {
    const response = await this.#http.post<{ media: MediaDetail }>(
      buildResourcePath('media', 'confirm'),
      input,
    )
    return response.media
  }

  /**
   * Fetches a file from a URL into the media library, server-side (SSRF
   * guarded, type allowlist, size ceiling). The file starts private (`DRAFT`):
   * the answer carries a 15-minute `signedUrl` and no `url` until `publish`.
   *
   * `POST /media/from-url`. Secret key, or suite bearer with
   * `zap:media:write`. Sends an `Idempotency-Key` (required of suite bearers;
   * a retry with the same key replays the first answer without downloading
   * again). Server-side only: the API's general CORS does not allow that
   * header from a browser.
   */
  async fromUrl(input: MediaFromUrlInput, options?: IdempotencyOptions): Promise<MediaDetail> {
    return this.#http.post<MediaDetail>(
      buildResourcePath('media', 'from-url'),
      input,
      idempotent(options),
    )
  }

  /**
   * Uploads media using the public presigned URL flow.
   */
  async upload(input: MediaUploadInput): Promise<MediaDetail> {
    const upload = await this.createUploadUrl({
      filename: input.filename,
      contentType: input.contentType,
      size: getUploadSize(input.file),
      width: input.width,
      height: input.height,
    })

    await this.#http.upload(upload.uploadUrl, toUploadBody(input.file), {
      'Content-Type': input.contentType,
    })

    const media = await this.confirmUpload({
      mediaId: upload.mediaId,
      key: upload.key,
      filename: input.filename,
      contentType: input.contentType,
      size: getUploadSize(input.file),
      width: input.width,
      height: input.height,
    })

    const alt = normalizeHeaderValue(input.alt)
    const title = normalizeHeaderValue(input.title)
    const description = normalizeHeaderValue(input.description)

    if (!alt && !title && !description) {
      return media
    }

    return this.update(media.id, {
      alt: alt ?? null,
      title: title ?? null,
      description: description ?? null,
    })
  }
}
