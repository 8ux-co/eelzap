import { HttpClient } from '../http'
import { buildResourcePath } from '../paths'
import type {
  CommentDraftAnswer,
  CommentListOptions,
  CommentListResponse,
  CommentReplyAnswer,
  CommentThreadAnswer,
  CreateCommentInput,
  OnPageComments,
  ReplyCommentInput,
  SaveCommentToDraftInput,
  UpdateCommentInput,
} from '../types/comments'
import type { IdempotencyOptions } from '../types/common'
import { idempotent } from './resource-helpers'

/**
 * «Comentarios» (`/comments`): comment threads on an entry or a document, a
 * thread flagged `isChangeRequest` carrying an assignee and proposed values.
 *
 * Suite bearers only (`eel_sk_…` / `eel_at_…`, with `X-Eel-Site`): a comment
 * has a person behind it, so site keys are refused. Reads need
 * `zap:content:read`; writes `zap:content:write`, and `create`, `reply` and
 * `saveToDraft` also take `zap:suggest:write`.
 */
export class CommentsResource {
  readonly #http: HttpClient

  /**
   * @internal
   */
  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Lists the site's threads, newest first, optionally on one record (an
   * entry by `collection` + `slug`, or a `document`). `counts` covers both
   * statuses whatever `status` filters.
   *
   * `GET /comments`.
   */
  async list(options?: CommentListOptions): Promise<CommentListResponse> {
    return this.#http.get<CommentListResponse>('/comments', {
      // Named one by one: the route's query is strict, so a stray key would be a 400.
      params: {
        collection: options?.collection,
        slug: options?.slug,
        document: options?.document,
        isChangeRequest: options?.isChangeRequest,
        status: options?.status,
        resolution: options?.resolution,
        pageUrl: options?.pageUrl,
        assignee: options?.assignee,
        page: options?.page,
        pageSize: options?.pageSize,
      },
    })
  }

  /**
   * Retrieves a thread and its comments, oldest first.
   *
   * `GET /comments/{id}`.
   */
  async get(id: string): Promise<CommentThreadAnswer> {
    return this.#http.get<CommentThreadAnswer>(buildResourcePath('comments', id))
  }

  /**
   * Opens a thread with its first comment. Anchors and proposed values name
   * fields by key. Sends an `Idempotency-Key`. 404 for an unknown record, 422
   * `INVALID_ANCHOR` / `INVALID_PROPOSED_VALUE` / `ASSIGNEE_NO_SEAT`, 429
   * `RATE_LIMITED`.
   *
   * `POST /comments`.
   *
   * @example
   * ```ts
   * await zap.comments.create({
   *   collection: 'blog',
   *   slug: 'hello-world',
   *   isChangeRequest: true,
   *   body: 'Shorter title?',
   *   proposedValues: [{ fieldKey: 'title', value: 'Hello' }],
   * })
   * ```
   */
  async create(
    input: CreateCommentInput,
    options?: IdempotencyOptions,
  ): Promise<CommentThreadAnswer> {
    return this.#http.post<CommentThreadAnswer>('/comments', input, idempotent(options))
  }

  /**
   * Changes a thread: `status` (resolve, reopen), a change request's
   * `resolution`, the `isChangeRequest` flag, the assignee, or the first
   * comment's text. 409 `STATUS_CONFLICT`, `INVALID_TRANSITION`,
   * `HAS_PROPOSAL`; 422 `NOT_A_CHANGE_REQUEST`, `HAS_LINKED_TASKS` (turning
   * the flag off while a Swarm task is linked).
   *
   * `PATCH /comments/{id}`.
   */
  async update(id: string, input: UpdateCommentInput): Promise<CommentThreadAnswer> {
    return this.#http.patch<CommentThreadAnswer>(buildResourcePath('comments', id), input)
  }

  /**
   * Replies on a thread. Sends an `Idempotency-Key`.
   *
   * `POST /comments/{id}/replies`.
   */
  async reply(
    id: string,
    input: ReplyCommentInput,
    options?: IdempotencyOptions,
  ): Promise<CommentReplyAnswer> {
    return this.#http.post<CommentReplyAnswer>(
      buildResourcePath('comments', id, 'replies'),
      input,
      idempotent(options),
    )
  }

  /**
   * «Aplicar al borrador»: writes an open change request's proposed values
   * into the record's draft and resolves it as APPLIED. 409 `NO_PROPOSAL` /
   * `NOT_OPEN`.
   *
   * `POST /comments/{id}/apply`.
   */
  async apply(id: string): Promise<CommentDraftAnswer> {
    return this.#http.post<CommentDraftAnswer>(buildResourcePath('comments', id, 'apply'))
  }

  /**
   * Writes proposed values straight into the record's draft, recorded as a
   * change request already resolved as APPLIED; nobody is notified. 403 when
   * the site has live editing off. Sends an `Idempotency-Key`.
   *
   * `POST /comments/save-to-draft`.
   */
  async saveToDraft(
    input: SaveCommentToDraftInput,
    options?: IdempotencyOptions,
  ): Promise<CommentDraftAnswer> {
    return this.#http.post<CommentDraftAnswer>(
      buildResourcePath('comments', 'save-to-draft'),
      input,
      idempotent(options),
    )
  }

  /**
   * What the site's suggestion client shows on one page: the viewer, whether
   * live editing is on, the field types of the records tagged there and the
   * page's open threads. `refs` are `data-zap-ref` values (`collection/slug`
   * or `doc:key`); at most 20 are read.
   *
   * `GET /comments/on-page`. Answers only the site's own suggestion client.
   */
  async onPage(url: string, refs: readonly string[] = []): Promise<OnPageComments> {
    return this.#http.get<OnPageComments>(buildResourcePath('comments', 'on-page'), {
      params: { url, refs: refs.length > 0 ? refs.join(',') : undefined },
    })
  }
}
