/**
 * «Comentarios»: comment threads on an entry or a document, as the public
 * API's `/comments` routes take and answer them. A thread flagged
 * `isChangeRequest` may carry an assignee, proposed values and, once
 * resolved, a resolution; a plain comment carries none of them.
 *
 * The public API speaks KEYS: a record by `collection` + `slug` or by
 * `document`, a field by its key. Every date is an ISO string.
 */

export type CommentStatus = 'OPEN' | 'RESOLVED'

/** How a change request was resolved; APPLIED also covers "changed by hand". */
export type CommentResolution = 'APPLIED' | 'DISMISSED'

/** Where the thread was made. The API derives it from the credential. */
export type CommentSource = 'EDITOR' | 'PREVIEW' | 'SITE' | 'API' | 'MCP'

export type CommentAnchorKind = 'field' | 'dom' | 'spot'

/** A page-normalised rectangle: every value between 0 and 1. */
export interface CommentRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CommentViewport {
  w: number
  h: number
}

/**
 * An element on a page: tag, then selector, then the W3C text quote, then the
 * rectangle. `selector` at most 1 KB, `textQuote.exact` at most 500 characters.
 */
export interface CommentDomAnchor {
  tag?: string
  selector?: string
  textQuote?: { exact: string; prefix?: string; suffix?: string }
  rect?: CommentRect
  viewport?: CommentViewport
}

/** A pin placed on the page, in page-normalised coordinates. */
export interface CommentSpotAnchor {
  spot: { x: number; y: number }
  viewport?: CommentViewport
}

/** A field anchor as the public API takes it: by key. */
export interface CommentFieldAnchorInput {
  key: string
  locale?: string | null
  /** A gallery index or a rich-text block, when the field alone is too coarse. */
  path?: string | null
}

/**
 * One anchor of a new thread: a field, an element on the page, or both (at
 * least one); or a spot. `dom` and `spot` anchors need the thread's `pageUrl`.
 */
export type CommentAnchorInput =
  | { field?: CommentFieldAnchorInput; dom?: CommentDomAnchor }
  | CommentSpotAnchor

/** An anchor as stored: the field layer carries the field's id and real key. */
export type CommentAnchor =
  | {
      field?: { id: string; key: string; locale: string | null; path: string | null }
      dom?: CommentDomAnchor
    }
  | CommentSpotAnchor

export interface CommentPersonRef {
  id: string
  name: string | null
  avatarUrl: string | null
}

export interface CommentVersionRef {
  id: string
  /** The version's number, or null when it no longer exists (discarded, pruned). */
  number: number | null
  /** Whether the record still sits on this version (its open draft, else its published one). */
  current: boolean
}

export type CommentTarget =
  | { type: 'item'; id: string; collectionId: string; slug: string }
  | { type: 'document'; id: string; key: string }

export interface CommentProposedValue {
  fieldId: string
  fieldKey: string
  locale: string | null
  value: string | number | null
}

/** A thread, without its comments. */
export interface CommentThread {
  id: string
  siteId: string
  target: CommentTarget
  isChangeRequest: boolean
  status: CommentStatus
  /** Set on a RESOLVED change request only. */
  resolution: CommentResolution | null
  source: CommentSource
  locale: string | null
  /** The page it was made on (origin and path), or null when made in the editor. */
  pageUrl: string | null
  anchors: CommentAnchor[]
  anchorKinds: CommentAnchorKind[]
  /** The fields the anchors point at, deduplicated, in anchor order. */
  fieldIds: string[]
  fieldKeys: string[]
  proposedValues: CommentProposedValue[] | null
  baseVersion: CommentVersionRef | null
  resolvedInVersion: CommentVersionRef | null
  assignee: CommentPersonRef | null
  createdBy: CommentPersonRef | null
  resolvedBy: CommentPersonRef | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  /** The first comment, shortened. */
  excerpt: string | null
  replyCount: number
  permissions: { canEdit: boolean; canDelete: boolean }
}

/** One comment of a thread. */
export interface ThreadComment {
  id: string
  author: CommentPersonRef | null
  /** Null on a system line. */
  body: string | null
  system: boolean
  systemCode: 'draft_discarded' | null
  /** The thread's opening comment. */
  isFirst: boolean
  edited: boolean
  createdAt: string
  updatedAt: string
}

/** `get`, `create` and `update`: the thread and every comment, oldest first. */
export interface CommentThreadAnswer {
  thread: CommentThread
  comments: ThreadComment[]
}

/** `apply` and `saveToDraft`: the resolved thread and the draft the values went into. */
export interface CommentDraftAnswer extends CommentThreadAnswer {
  draftVersionId: string
}

/**
 * `reply`: the new comment and the thread. Under `zap:suggest:write` alone the
 * thread is only `{ id, status }`, with no comments.
 */
export type CommentReplyAnswer =
  | { comment: ThreadComment; thread: CommentThread; comments: ThreadComment[] }
  | { comment: ThreadComment; thread: { id: string; status: CommentStatus }; comments?: undefined }

export interface CommentListResponse {
  items: CommentThread[]
  /** Across both statuses, whatever `status` filters. */
  counts: Record<CommentStatus, number>
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

/** A record: an entry (`collection` + `slug`) or a document (`document`). */
export type CommentRecord =
  | { collection: string; slug: string; document?: never }
  | { document: string; collection?: never; slug?: never }

export interface CommentListOptions {
  /** With `slug`: the threads of one entry. */
  collection?: string
  slug?: string
  /** The threads of one document. */
  document?: string
  isChangeRequest?: boolean
  status?: CommentStatus
  resolution?: CommentResolution
  /** The page the threads were made on; normalised before it is compared. */
  pageUrl?: string
  /** `me`, `none`, or a user id. */
  assignee?: 'me' | 'none' | (string & {})
  page?: number
  /** 1 to 100, default 50. */
  pageSize?: number
}

export interface CommentProposedValueInput {
  fieldKey: string
  locale?: string | null
  value: string | number | null
}

interface CommentWriteBase {
  locale?: string | null
  /** An http(s) URL; needed by `dom` and `spot` anchors. */
  pageUrl?: string
  /** 0 to 20; none means the whole page (with a `pageUrl`) or the whole record. */
  anchors?: CommentAnchorInput[]
  /** The first comment, 1 to 10,000 characters. */
  body: string
}

/**
 * `create`. `assigneeId` and `proposedValues` go with a change request only.
 * Without `assigneeId`, a change request goes to the record's Responsable when
 * they hold Zap; `null` assigns nobody.
 */
export type CreateCommentInput = CommentRecord &
  CommentWriteBase & {
    isChangeRequest?: boolean
    assigneeId?: string | null
    /** At most 20; TEXT, LONG_TEXT, NUMBER and URL fields. */
    proposedValues?: CommentProposedValueInput[]
  }

/** `saveToDraft`: always a change request, no assignee, at least one proposed value. */
export type SaveCommentToDraftInput = CommentRecord &
  CommentWriteBase & {
    proposedValues: CommentProposedValueInput[]
  }

/** `update`: at least one. */
export interface UpdateCommentInput {
  status?: CommentStatus
  /** A change request's; given with `status: 'OPEN'` it is 409 `INVALID_TRANSITION`. */
  resolution?: CommentResolution
  /**
   * Turning it off is 409 `HAS_PROPOSAL` on a thread with proposed values, and
   * 422 `HAS_LINKED_TASKS` while any Swarm task is linked to it.
   */
  isChangeRequest?: boolean
  assigneeId?: string | null
  /** The first comment's text (its author or an ADMIN). */
  body?: string
}

export interface ReplyCommentInput {
  body: string
}

/** The field types `onPage` describes, per record ref and field key. */
export interface OnPageField {
  type: string
  label: string
}

export interface OnPageCommentAnchor {
  fieldKey: string | null
  tag: string | null
  selector: string | null
  rect: CommentRect | null
  spot: { x: number; y: number } | null
}

export interface OnPageComment {
  id: string
  status: 'OPEN'
  isChangeRequest: boolean
  createdAt: string
  author: { name: string | null } | null
  excerpt: string | null
  anchors: OnPageCommentAnchor[]
}

/** `onPage`: what the site's suggestion client needs on one page. */
export interface OnPageComments {
  /**
   * The signed-in person: their own name and email, and `editorUrl`, the
   * absolute Zap editor URL of the entry or document this page is (an entry
   * first when several are), or null.
   */
  viewer: { name: string | null; email: string | null; editorUrl: string | null }
  /** Whether the site lets people save straight to the draft. */
  liveEditing: boolean
  /** Record ref → field key → field. */
  fields: Record<string, Record<string, OnPageField>>
  /** The page's open threads. */
  comments: OnPageComment[]
  truncated: boolean
}
