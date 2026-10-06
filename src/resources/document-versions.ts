import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type {
  CreateDraftInput,
  DocumentVersionDetail,
  DocumentVersionSummary,
  UpdateDocumentDraftInput,
  VersionListResponse,
} from '../types/versions'

/**
 * Version history, drafts and rollbacks for documents
 * (`/documents/{documentKey}/versions…`).
 *
 * A document has at most one open draft. Writing needs a secret key;
 * publishing and rolling back need one with publish rights.
 */
export class DocumentVersionsResource {
  readonly #http: HttpClient

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Lists a document's versions, newest first.
   */
  async list(documentKey: string): Promise<VersionListResponse<DocumentVersionSummary>> {
    return this.#http.get<VersionListResponse<DocumentVersionSummary>>(
      buildResourcePath('documents', documentKey, 'versions'),
    )
  }

  /**
   * Gets one version with its snapshot (values and SEO).
   */
  async get(documentKey: string, versionId: string): Promise<DocumentVersionDetail> {
    const response = await this.#http.get<{ version: DocumentVersionDetail }>(
      buildResourcePath('documents', documentKey, 'versions', versionId),
    )
    return response.version
  }

  /**
   * Opens a draft from the document's live state. Fails with `DUPLICATE_KEY`
   * (409) when the document already has one.
   */
  async createDraft(
    documentKey: string,
    input?: CreateDraftInput,
  ): Promise<DocumentVersionSummary> {
    const response = await this.#http.post<{ version: DocumentVersionSummary }>(
      buildResourcePath('documents', documentKey, 'versions'),
      input,
    )
    return response.version
  }

  /**
   * Stages values on the open draft without touching the live document.
   * Fails with `VALIDATION_ERROR` (400) when there is no open draft.
   */
  async updateDraft(
    documentKey: string,
    input: UpdateDocumentDraftInput,
  ): Promise<DocumentVersionDetail> {
    const response = await this.#http.put<{ version: DocumentVersionDetail }>(
      buildResourcePath('documents', documentKey, 'versions', 'draft'),
      input,
    )
    return response.version
  }

  /**
   * Discards the open draft. Fails with `NOT_FOUND` (404) when there is none.
   */
  async discardDraft(documentKey: string): Promise<void> {
    await this.#http.delete<unknown>(
      buildResourcePath('documents', documentKey, 'versions', 'draft'),
    )
  }

  /**
   * Publishes the open draft: its values go live and it becomes the
   * document's published version. Fails with `NOT_FOUND` (404) when there is
   * no draft.
   */
  async publishDraft(documentKey: string): Promise<DocumentVersionSummary> {
    const response = await this.#http.post<{ version: DocumentVersionSummary }>(
      buildResourcePath('documents', documentKey, 'versions', 'draft', 'publish'),
    )
    return response.version
  }

  /**
   * Restores a past version over the live document and records the restore
   * as a NEW published version (history is never rewritten). Refused (409)
   * for a draft version, or while the document has an open draft.
   */
  async rollback(documentKey: string, versionId: string): Promise<DocumentVersionSummary> {
    const response = await this.#http.post<{ version: DocumentVersionSummary }>(
      buildResourcePath('documents', documentKey, 'versions', versionId, 'rollback'),
    )
    return response.version
  }
}
