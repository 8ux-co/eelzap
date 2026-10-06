/**
 * Outbound webhooks, as the Eel suite sends them (ADR 031): a workspace
 * endpoint subscribes to `zap.*` events, and every delivery is a JSON envelope
 * signed with the endpoint's `whsec_…` secret. See `verifyWebhookSignature`.
 *
 * Payloads are minimal by design: ids, keys, slugs, links, version numbers and
 * the NAMES of what changed — never a field value. Read the content itself
 * with the delivery API.
 */

/** Every Zap event an endpoint can receive, plus `ping` (the test button). */
export type WebhookEventName =
  | 'ping'
  | 'zap.item.created'
  | 'zap.item.updated'
  | 'zap.item.draft_updated'
  | 'zap.item.published'
  | 'zap.item.unpublished'
  | 'zap.item.deleted'
  | 'zap.item.rolled_back'
  | 'zap.item.assigned'
  | 'zap.document.created'
  | 'zap.document.updated'
  | 'zap.document.draft_updated'
  | 'zap.document.published'
  | 'zap.document.unpublished'
  | 'zap.document.deleted'
  | 'zap.document.rolled_back'
  | 'zap.document.assigned'
  | 'zap.seo.updated'
  | 'zap.comment.created'
  | 'zap.comment.replied'
  | 'zap.comment.resolved'
  | 'zap.comment.reopened'
  | 'zap.comment.updated'
  | 'zap.media.uploaded'
  | 'zap.media.updated'
  | 'zap.media.published'
  | 'zap.media.unpublished'
  | 'zap.media.deleted'
  | 'zap.collection.created'
  | 'zap.collection.updated'
  | 'zap.collection.deleted'
  | 'zap.schema.field_changed'
  | 'zap.site.created'
  | 'zap.site.updated'
  | 'zap.site.deleted'
  | 'zap.site.api_key.created'
  | 'zap.site.api_key.revoked'

/** Who made the change. `user_id` is null for an API key or system work. */
export interface WebhookActor {
  user_id: string | null
  display_name: string
  kind: 'USER' | 'SYSTEM' | 'API_KEY'
}

/** What the event is about, at the id level. Zap events carry `site_id`, and `collection_id` for collection-scoped events. */
export interface WebhookSubject {
  workspace_id: string
  site_id?: string
  collection_id?: string
}

/**
 * The delivery body. `id` is the idempotency key: it is the same across
 * retries and across endpoints, so dedupe on it (not on `X-Eel-Delivery`).
 * `type` is a {@link WebhookEventName}; it is typed as a string too because an
 * endpoint can also subscribe to other suite apps' events.
 */
export interface WebhookPayload<TData = unknown> {
  id: string
  type: WebhookEventName | (string & {})
  /** Payload contract version. 2 today. */
  version: number
  app: string
  workspace_id: string
  /** ISO timestamp of the change. */
  occurred_at: string
  actor: WebhookActor
  subject: WebhookSubject
  data: TData
}

/** A link into Zap. Null when it cannot be built. */
type ZapLink = string | null

export interface WebhookSiteRef {
  id: string
  key: string
  url: ZapLink
}

export interface WebhookCollectionRef {
  id: string
  key: string
}

/** `data` of the `zap.item.*` content events (not `zap.item.assigned`). */
export interface WebhookItemEventData {
  site: WebhookSiteRef
  collection: WebhookCollectionRef
  items: Array<{
    id: string
    slug: string
    url: ZapLink
    /** The version the event is about; null after a discarded draft. */
    version?: number | null
    /** Names of the fields or properties that changed. */
    changed?: string[]
    /** On a rollback: the version number that was restored. */
    restored_from?: number | null
  }>
}

/** `data` of the `zap.document.*` content events (not `zap.document.assigned`). */
export interface WebhookDocumentEventData {
  site: WebhookSiteRef
  documents: Array<{
    id: string
    key: string
    url: ZapLink
    version?: number | null
    changed?: string[]
    restored_from?: number | null
  }>
}

/** `data` of the `zap.media.*` events. */
export interface WebhookMediaEventData {
  site: WebhookSiteRef
  media: Array<{ id: string; url: ZapLink; filename?: string }>
}

/** The kind of content a {@link WebhookChange} is about. */
export type WebhookEventType = 'item' | 'document' | 'media'

/** What happened to it: the verb of the event name. */
export type WebhookAction =
  | 'created'
  | 'updated'
  | 'draft_updated'
  | 'published'
  | 'unpublished'
  | 'deleted'
  | 'rolled_back'
  | 'uploaded'

/**
 * One changed item, document or file, flattened out of a payload by
 * `webhookChanges` — the unit a site invalidates its cache by.
 */
export interface WebhookChange {
  type: WebhookEventType
  action: WebhookAction
  id: string
  /** The item's slug, the document's key, or the file's id. */
  resourceKey: string
  /** The item's collection. Items only. */
  collectionKey?: string
  siteKey: string
}

/** A comment thread's record: the entry (`slug`) or the document (`key`) it is on. */
export interface WebhookCommentTarget {
  type: 'item' | 'document'
  id: string
  key: string
}

/** The fields every comment entry carries. Never the comment text. */
export interface WebhookCommentRef {
  id: string
  /** The record page, opened on the thread. */
  url: string
  target: WebhookCommentTarget
}

/** The `data` of every `zap.comment.*` event: one envelope per (event, site, collection). */
export interface WebhookCommentData<TEntry extends WebhookCommentRef = WebhookCommentRef> {
  site: { id: string; key: string; url: string }
  /** Null for events on documents. */
  collection: { id: string; key: string } | null
  comments: TEntry[]
}

export type WebhookCommentSource = 'EDITOR' | 'PREVIEW' | 'SITE' | 'API' | 'MCP'

/** `data` of `zap.comment.created`. */
export type WebhookCommentCreatedData = WebhookCommentData<
  WebhookCommentRef & {
    is_change_request: boolean
    source: WebhookCommentSource
    anchor_kinds: ('field' | 'dom' | 'spot')[]
    /** Field keys, never values. */
    field_keys: string[]
  }
>

/** `data` of `zap.comment.replied`. */
export type WebhookCommentRepliedData = WebhookCommentData<
  WebhookCommentRef & { comment_id: string }
>

/** `data` of `zap.comment.resolved`. */
export type WebhookCommentResolvedData = WebhookCommentData<
  WebhookCommentRef & {
    is_change_request: boolean
    resolution: 'APPLIED' | 'DISMISSED' | null
    resolved_in_version_id: string | null
  }
>

/** `data` of `zap.comment.reopened`. */
export type WebhookCommentReopenedData = WebhookCommentData<
  WebhookCommentRef & {
    cause: 'manual' | 'draft_discarded'
    resolved_in_version_id: string | null
  }
>

/** `data` of `zap.comment.updated`. */
export type WebhookCommentUpdatedData = WebhookCommentData<
  WebhookCommentRef & {
    changed: ('assignee' | 'is_change_request' | 'resolution')[]
    is_change_request: boolean
    assignee_id: string | null
  }
>
