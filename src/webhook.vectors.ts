/**
 * Fixed webhook test vectors: a secret, a timestamp, a raw body and the
 * `X-Eel-Signature` Zap sends for them, computed once by the suite's real
 * signer (`signWebhookPayload`, ADR 031 §4.1) and committed here, so the
 * public package can prove `verifyWebhookSignature` against what Zap actually
 * sends without the signer itself.
 *
 *   X-Eel-Timestamp: <timestamp>
 *   X-Eel-Signature: v1=<hex HMAC-SHA256(`${timestamp}.${body}`)>
 *
 * keyed with the UTF-8 of the secret minus `whsec_`. Test data only: the
 * secret is not, and never was, a real endpoint's.
 */

export interface WebhookVector {
  name: string
  secret: string
  /** Unix seconds: the `X-Eel-Timestamp` header, and part of the signed content. */
  timestamp: number
  /** The body exactly as sent. */
  body: string
  /** The `X-Eel-Signature` header. */
  signature: string
}

export const VECTOR_SECRET = 'whsec_vEctor5TestOnlyNotARealSecret01'

export const WEBHOOK_VECTORS: readonly WebhookVector[] = [
  {
    name: 'an item event envelope, as the drain serialises it',
    secret: VECTOR_SECRET,
    timestamp: 1759665600,
    body: '{"id":"6f1c3c1e-8a9a-4c39-9d6b-3c1f0d7f9a10","type":"zap.item.published","version":2,"app":"zap","workspace_id":"0d3a8f8e-5d9b-4a64-9c11-7ad1d8c1c001","occurred_at":"2025-10-05T12:00:00.000Z","actor":{"user_id":null,"display_name":"API key","kind":"API_KEY"},"subject":{"workspace_id":"0d3a8f8e-5d9b-4a64-9c11-7ad1d8c1c001","site_id":"1e2f3a4b-0000-4000-8000-000000000001","collection_id":"1e2f3a4b-0000-4000-8000-000000000002"},"data":{"site":{"id":"1e2f3a4b-0000-4000-8000-000000000001","key":"catering","url":null},"collection":{"id":"1e2f3a4b-0000-4000-8000-000000000002","key":"blog"},"items":[{"id":"1e2f3a4b-0000-4000-8000-000000000003","slug":"hello-world","url":null,"version":4}]}}',
    signature: 'v1=637a3bc9fd616f6ac2c38ee72694035bc00655483b8605c3bb3bcc2e3a2f6ec5',
  },
  {
    name: 'a body with multi-byte UTF-8 and JSON escapes',
    secret: VECTOR_SECRET,
    timestamp: 1759665617,
    body: '{"id":"evt_unicode","type":"zap.document.updated","version":2,"data":{"title":"Café «Sabor» — 東京 🐟","note":"line\\nbreak \\"quoted\\" \\\\ backslash"}}',
    signature: 'v1=468802ae2615a0c14b0cf059d6acf66f8078d8a339a4b6671f34990f1bac8e76',
  },
  {
    name: 'an empty body',
    secret: VECTOR_SECRET,
    timestamp: 1759665642,
    body: '',
    signature: 'v1=9a4f303c8eb150777a2a2be038f905a8c34b420977dcfe597bcb2c8bc309f168',
  },
]

/**
 * Near misses for the first vector, from the same signer: what a verifier
 * would accept if it got the scheme subtly wrong. Each must be refused.
 */
export const NEAR_MISS_SIGNATURES = {
  /** Keyed with the whole token, `whsec_` included (the prefix not stripped). */
  prefixKept: 'v1=fff5193053fe1f8962758ddf3dcfd0951472289ebd3e876efde2100ffe3daa66',
  /** The MAC of the body alone, without the timestamp. */
  bodyOnly: 'v1=cf8e6a4b5a7555145a41675be48ad95994ebd1fefe3f514708bc7c21f8dccfb4',
} as const
