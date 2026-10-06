import type {
  WebhookAction,
  WebhookChange,
  WebhookDocumentEventData,
  WebhookEventType,
  WebhookItemEventData,
  WebhookMediaEventData,
  WebhookPayload,
} from './types/webhook'

/*
 * Webhook signature verification, written against WebCrypto only
 * (`globalThis.crypto.subtle`) so the same code runs in Node 20+, edge
 * runtimes, workers and browsers. This module must not import anything at
 * runtime — not `node:crypto`, not another SDK module — so it stays in the
 * root entry without tying it to Node. The edge test evaluates it in a bare
 * VM context to keep it that way.
 *
 * The scheme is the suite's (ADR 031 §4.1, `@eel/webhooks` sign.ts):
 *
 *   X-Eel-Timestamp: <unix seconds>
 *   X-Eel-Signature: v1=<hex HMAC-SHA256(`${timestamp}.${rawBody}`)>
 *
 * keyed with the UTF-8 bytes of the endpoint secret minus its `whsec_` prefix.
 * The timestamp is inside the MAC, so a captured delivery cannot be replayed
 * outside the tolerance window by changing the header.
 */

/** Header carrying `v1=<hex>`. Header lookups are case-insensitive. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Eel-Signature'
/** Header carrying the unix-second timestamp that is part of the signed content. */
export const WEBHOOK_TIMESTAMP_HEADER = 'X-Eel-Timestamp'
/** Deliveries older or newer than this, in seconds, are refused: 5 minutes. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

const SECRET_PREFIX = 'whsec_'
const SIGNATURE_PREFIX = 'v1='
const HMAC_SHA256_HEX_LENGTH = 64

/**
 * The request headers: a Fetch `Headers` (Next.js route handlers, workers), or
 * a plain object such as Node's `IncomingHttpHeaders` (Express).
 */
export type WebhookHeaders =
  | Pick<Headers, 'get'>
  | Record<string, string | readonly string[] | undefined>

export interface VerifyWebhookOptions {
  /** Maximum clock difference in seconds. Default {@link WEBHOOK_TOLERANCE_SECONDS}. */
  toleranceSeconds?: number
  /** The current time. Default `new Date()`. */
  now?: Date
}

function readHeader(headers: WebhookHeaders, name: string): string | null {
  if (typeof (headers as Pick<Headers, 'get'>).get === 'function') {
    return (headers as Pick<Headers, 'get'>).get(name)
  }
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted || value === undefined) continue
    // A repeated header is ambiguous: refuse rather than pick one.
    if (typeof value === 'string') return value
    return value.length === 1 ? (value[0] ?? null) : null
  }
  return null
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length !== HMAC_SHA256_HEX_LENGTH || !/^[0-9a-f]+$/i.test(value)) {
    return null
  }
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (!subtle) {
    // A misconfigured runtime is not a forged request, so it is not `false`.
    throw new Error(
      'verifyWebhookSignature needs WebCrypto (globalThis.crypto.subtle). ' +
        'Node 18 does not expose it by default: use Node 20+, or set ' +
        "globalThis.crypto to node:crypto's webcrypto at startup.",
    )
  }
  return subtle
}

/**
 * Verifies a webhook delivery: the signature over the raw body and the
 * timestamp, and that the timestamp is within the tolerance window.
 *
 * Pass the body exactly as received (`await request.text()`), never a
 * re-serialised parse: the MAC covers the bytes that were sent.
 *
 * @returns `true` only for an authentic, fresh delivery. Any missing or
 *   malformed header, wrong secret, altered body or stale timestamp is `false`.
 * @throws When the runtime has no WebCrypto.
 *
 * @example
 * ```ts
 * const payload = await request.text()
 * if (!(await verifyWebhookSignature(payload, request.headers, process.env.EELZAP_WEBHOOK_SECRET!))) {
 *   return new Response('Invalid signature', { status: 401 })
 * }
 * ```
 */
export async function verifyWebhookSignature(
  payload: string,
  headers: WebhookHeaders,
  secret: string,
  options: VerifyWebhookOptions = {},
): Promise<boolean> {
  if (
    typeof payload !== 'string' ||
    typeof secret !== 'string' ||
    !headers ||
    typeof headers !== 'object'
  ) {
    return false
  }

  const key = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret
  if (!key) {
    return false
  }

  const timestamp = readHeader(headers, WEBHOOK_TIMESTAMP_HEADER)?.trim()
  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return false
  }
  const nowSeconds = (options.now ?? new Date()).getTime() / 1000
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS
  if (!(Math.abs(nowSeconds - Number(timestamp)) <= tolerance)) {
    return false
  }

  const signature = readHeader(headers, WEBHOOK_SIGNATURE_HEADER)?.trim()
  if (!signature?.startsWith(SIGNATURE_PREFIX)) {
    return false
  }
  const signatureBytes = hexToBytes(signature.slice(SIGNATURE_PREFIX.length))
  if (!signatureBytes) {
    return false
  }

  const subtle = getSubtle()
  const encoder = new TextEncoder()
  const hmacKey = await subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  // `verify` compares in constant time, unlike comparing two hex strings.
  return subtle.verify('HMAC', hmacKey, signatureBytes, encoder.encode(`${timestamp}.${payload}`))
}

const CHANGE_ACTIONS: ReadonlySet<string> = new Set<WebhookAction>([
  'created',
  'updated',
  'draft_updated',
  'published',
  'unpublished',
  'deleted',
  'rolled_back',
  'uploaded',
])

/**
 * Flattens a Zap content event into one {@link WebhookChange} per item,
 * document or file it names — what a site walks to invalidate its cache.
 * Every other event (`ping`, schema, site, SEO, assignment, comment
 * events) yields an empty list.
 */
export function webhookChanges(payload: WebhookPayload): WebhookChange[] {
  const match = /^zap\.(item|document|media)\.([a-z_]+)$/.exec(payload.type)
  if (!match || !CHANGE_ACTIONS.has(match[2]!)) {
    return []
  }
  const type = match[1] as WebhookEventType
  const action = match[2] as WebhookAction

  if (type === 'item') {
    const data = payload.data as WebhookItemEventData
    return (data.items ?? []).map((item) => ({
      type,
      action,
      id: item.id,
      resourceKey: item.slug,
      collectionKey: data.collection.key,
      siteKey: data.site.key,
    }))
  }
  if (type === 'document') {
    const data = payload.data as WebhookDocumentEventData
    return (data.documents ?? []).map((document) => ({
      type,
      action,
      id: document.id,
      resourceKey: document.key,
      siteKey: data.site.key,
    }))
  }
  const data = payload.data as WebhookMediaEventData
  return (data.media ?? []).map((media) => ({
    type,
    action,
    id: media.id,
    resourceKey: media.id,
    siteKey: data.site.key,
  }))
}
