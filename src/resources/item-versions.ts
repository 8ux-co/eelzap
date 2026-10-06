import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type {
  CreateDraftInput,
  ItemVersionDetail,
  ItemVersionSummary,
  UpdateItemDraftInput,
  VersionListResponse,
} from '../types/versions'

/**
 * Version history, drafts and rollbacks for collection items
 * (`/collections/{collectionKey}/items/{slug}/versions…`).
 *
 * An item has at most one open draft. Writing needs a secret key; publishing
 * and rolling back need one with publish rights.
 */
export class ItemVersionsResource {
  readonly #http: HttpClient

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Lists an item's versions, newest first.
   */
  async list(
    collectionKey: string,
    slug: string,
  ): Promise<VersionListResponse<ItemVersionSummary>> {
    return this.#http.get<VersionListResponse<ItemVersionSummary>>(
      buildResourcePath('collections', collectionKey, 'items', slug, 'versions'),
    )
  }

  /**
   * Gets one version with its snapshot (values, SEO and slugs).
   */
  async get(collectionKey: string, slug: string, versionId: string): Promise<ItemVersionDetail> {
    const response = await this.#http.get<{ version: ItemVersionDetail }>(
      buildResourcePath('collections', collectionKey, 'items', slug, 'versions', versionId),
    )
    return response.version
  }

  /**
   * Opens a draft from the item's live state. Fails with `DUPLICATE_KEY` (409)
   * when the item already has one.
   */
  async createDraft(
    collectionKey: string,
    slug: string,
    input?: CreateDraftInput,
  ): Promise<ItemVersionSummary> {
    const response = await this.#http.post<{ version: ItemVersionSummary }>(
      buildResourcePath('collections', collectionKey, 'items', slug, 'versions'),
      input,
    )
    return response.version
  }

  /**
   * Stages values (and optionally a new slug) on the open draft without
   * touching the live item. Fails with `VALIDATION_ERROR` (400) when there is
   * no open draft.
   */
  async updateDraft(
    collectionKey: string,
    slug: string,
    input: UpdateItemDraftInput,
  ): Promise<ItemVersionDetail> {
    const response = await this.#http.put<{ version: ItemVersionDetail }>(
      buildResourcePath('collections', collectionKey, 'items', slug, 'versions', 'draft'),
      input,
    )
    return response.version
  }

  /**
   * Discards the open draft. Fails with `NOT_FOUND` (404) when there is none.
   */
  async discardDraft(collectionKey: string, slug: string): Promise<void> {
    await this.#http.delete<unknown>(
      buildResourcePath('collections', collectionKey, 'items', slug, 'versions', 'draft'),
    )
  }

  /**
   * Publishes the open draft: its values go live and it becomes the item's
   * published version. Fails with `NOT_FOUND` (404) when there is no draft.
   */
  async publishDraft(collectionKey: string, slug: string): Promise<ItemVersionSummary> {
    const response = await this.#http.post<{ version: ItemVersionSummary }>(
      buildResourcePath(
        'collections',
        collectionKey,
        'items',
        slug,
        'versions',
        'draft',
        'publish',
      ),
    )
    return response.version
  }

  /**
   * Restores a past version over the live item and records the restore as a
   * NEW published version (history is never rewritten). Refused (409) for a
   * draft version, or while the item has an open draft.
   */
  async rollback(
    collectionKey: string,
    slug: string,
    versionId: string,
  ): Promise<ItemVersionSummary> {
    const response = await this.#http.post<{ version: ItemVersionSummary }>(
      buildResourcePath(
        'collections',
        collectionKey,
        'items',
        slug,
        'versions',
        versionId,
        'rollback',
      ),
    )
    return response.version
  }
}
