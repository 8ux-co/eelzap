import { describe, expect, it } from 'vitest'

import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
  type WebhookHeaders,
} from './webhook'
import { NEAR_MISS_SIGNATURES, VECTOR_SECRET, WEBHOOK_VECTORS } from './webhook.vectors'

/*
 * `verifyWebhookSignature` against fixed vectors: signatures Zap's signer
 * produced for a known secret, timestamp and body (`webhook.vectors.ts`). Each
 * refusal case changes one thing about an otherwise valid delivery, so a
 * `false` here is the check under test and nothing else.
 */

const [VECTOR] = WEBHOOK_VECTORS
const { body: BODY, timestamp: TS, signature: SIGNATURE } = VECTOR!
const AT = new Date(TS * 1000)
const BARE_SECRET = VECTOR_SECRET.slice('whsec_'.length)

function headersFor(timestamp: string | number, signature: string): Record<string, string> {
  return {
    [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
    [WEBHOOK_SIGNATURE_HEADER]: signature,
  }
}

const verify = (
  body: string,
  headers: WebhookHeaders,
  secret = VECTOR_SECRET,
  now: Date = AT,
  toleranceSeconds?: number,
) => verifyWebhookSignature(body, headers, secret, { now, toleranceSeconds })

describe('webhook vectors: authentic deliveries verify', () => {
  it.each(WEBHOOK_VECTORS)('$name', async (vector) => {
    const at = new Date(vector.timestamp * 1000)
    const plain = headersFor(vector.timestamp, vector.signature)

    await expect(verify(vector.body, plain, vector.secret, at)).resolves.toBe(true)
    // A Fetch `Headers`, as a route handler or worker receives it.
    await expect(verify(vector.body, new Headers(plain), vector.secret, at)).resolves.toBe(true)
    // Node lowercases incoming header names.
    const lower = Object.fromEntries(Object.entries(plain).map(([k, v]) => [k.toLowerCase(), v]))
    await expect(verify(vector.body, lower, vector.secret, at)).resolves.toBe(true)
  })

  it('anywhere inside the tolerance window, both sides of the clock', async () => {
    const headers = headersFor(TS, SIGNATURE)
    for (const offset of [-WEBHOOK_TOLERANCE_SECONDS, -1, 0, 1, WEBHOOK_TOLERANCE_SECONDS]) {
      await expect(
        verify(BODY, headers, VECTOR_SECRET, new Date((TS + offset) * 1000)),
      ).resolves.toBe(true)
    }
  })
})

describe('webhook vectors: a tampered body is refused', () => {
  it.each([
    ['a trailing space', `${BODY} `],
    ['a trailing newline', `${BODY}\n`],
    ['one character changed', BODY.replace('hello-world', 'hello-worle')],
    ['re-serialised with other spacing', JSON.stringify(JSON.parse(BODY), null, 2)],
    ['another vector’s body', WEBHOOK_VECTORS[1]!.body],
    ['empty', ''],
  ])('%s', async (_label, body) => {
    expect(body).not.toBe(BODY)
    await expect(verify(body, headersFor(TS, SIGNATURE))).resolves.toBe(false)
  })

  it('a multi-byte character swapped for a look-alike', async () => {
    const vector = WEBHOOK_VECTORS[1]!
    const at = new Date(vector.timestamp * 1000)
    const headers = headersFor(vector.timestamp, vector.signature)
    await expect(verify(vector.body, headers, vector.secret, at)).resolves.toBe(true)
    await expect(verify(vector.body.replace('é', 'é'), headers, vector.secret, at)).resolves.toBe(
      false,
    )
  })
})

describe('webhook vectors: the wrong secret is refused', () => {
  it.each([
    ['another whsec_ secret', 'whsec_vEctor5TestOnlyNotARealSecret02'],
    ['one character off', VECTOR_SECRET.replace(/.$/, '2')],
    ['the secret with the prefix doubled', `whsec_${VECTOR_SECRET}`],
    ['an empty secret', ''],
    ['the prefix alone', 'whsec_'],
  ])('%s', async (_label, secret) => {
    await expect(verify(BODY, headersFor(TS, SIGNATURE), secret)).resolves.toBe(false)
  })
})

describe('webhook vectors: `whsec_` prefix handling', () => {
  it('the secret verifies with or without its prefix: the key is the token minus `whsec_`', async () => {
    const headers = headersFor(TS, SIGNATURE)
    await expect(verify(BODY, headers, VECTOR_SECRET)).resolves.toBe(true)
    await expect(verify(BODY, headers, BARE_SECRET)).resolves.toBe(true)
  })

  it('a signature keyed with the prefix still in the key is refused', async () => {
    await expect(verify(BODY, headersFor(TS, NEAR_MISS_SIGNATURES.prefixKept))).resolves.toBe(false)
    await expect(
      verify(BODY, headersFor(TS, NEAR_MISS_SIGNATURES.prefixKept), BARE_SECRET),
    ).resolves.toBe(false)
  })

  it('only a leading `whsec_` is stripped', async () => {
    await expect(verify(BODY, headersFor(TS, SIGNATURE), ` ${VECTOR_SECRET}`)).resolves.toBe(false)
    await expect(verify(BODY, headersFor(TS, SIGNATURE), `${BARE_SECRET}whsec_`)).resolves.toBe(
      false,
    )
  })
})

describe('webhook vectors: a wrong or stale timestamp is refused', () => {
  it('a timestamp header other than the signed one, inside the window', async () => {
    // The timestamp is inside the MAC: moving it re-dates nothing.
    for (const timestamp of [TS + 1, TS - 1, TS + 60]) {
      await expect(verify(BODY, headersFor(timestamp, SIGNATURE))).resolves.toBe(false)
    }
  })

  it('a signature over the body alone, with no timestamp in the MAC', async () => {
    await expect(verify(BODY, headersFor(TS, NEAR_MISS_SIGNATURES.bodyOnly))).resolves.toBe(false)
  })

  it('older or newer than the tolerance', async () => {
    const headers = headersFor(TS, SIGNATURE)
    const off = WEBHOOK_TOLERANCE_SECONDS + 1
    await expect(verify(BODY, headers, VECTOR_SECRET, new Date((TS + off) * 1000))).resolves.toBe(
      false,
    )
    await expect(verify(BODY, headers, VECTOR_SECRET, new Date((TS - off) * 1000))).resolves.toBe(
      false,
    )
    // A day-old capture replayed as is.
    await expect(
      verify(BODY, headers, VECTOR_SECRET, new Date((TS + 86_400) * 1000)),
    ).resolves.toBe(false)
  })

  it('honours a custom tolerance, both ways', async () => {
    const headers = headersFor(TS, SIGNATURE)
    const later = new Date((TS + 30) * 1000)
    await expect(verify(BODY, headers, VECTOR_SECRET, later, 29)).resolves.toBe(false)
    await expect(verify(BODY, headers, VECTOR_SECRET, later, 30)).resolves.toBe(true)
  })

  it.each([
    ['empty', ''],
    ['not a number', 'yesterday'],
    ['milliseconds', String(TS * 1000)],
    ['a decimal', `${TS}.0`],
    ['negative', `-${TS}`],
    ['an ISO date', AT.toISOString()],
  ])('a malformed timestamp: %s', async (_label, timestamp) => {
    await expect(verify(BODY, headersFor(timestamp, SIGNATURE))).resolves.toBe(false)
  })
})

describe('webhook vectors: missing headers are refused', () => {
  it.each([
    ['no headers at all', {}],
    ['no signature', { [WEBHOOK_TIMESTAMP_HEADER]: String(TS) }],
    ['no timestamp', { [WEBHOOK_SIGNATURE_HEADER]: SIGNATURE }],
    ['an empty Headers', new Headers()],
    ['the old 0.9.0 header only', { 'X-EelZap-Signature': SIGNATURE.replace('v1=', 'sha256=') }],
  ] as Array<[string, WebhookHeaders]>)('%s', async (_label, headers) => {
    await expect(verify(BODY, headers)).resolves.toBe(false)
  })

  it('a header sent twice (ambiguous: neither is picked)', async () => {
    await expect(
      verify(BODY, {
        [WEBHOOK_TIMESTAMP_HEADER]: String(TS),
        [WEBHOOK_SIGNATURE_HEADER]: [SIGNATURE, SIGNATURE],
      }),
    ).resolves.toBe(false)
  })
})

describe('webhook vectors: a malformed signature is refused', () => {
  const hex = SIGNATURE.slice('v1='.length)
  it.each([
    ['no scheme', hex],
    ['another scheme', `v0=${hex}`],
    ['the 0.9.0 scheme', `sha256=${hex}`],
    ['scheme only', 'v1='],
    ['one hex digit short', `v1=${hex.slice(0, -1)}`],
    ['one hex digit long', `v1=${hex}0`],
    ['a non-hex digit', `v1=${hex.slice(0, -1)}g`],
    ['last digit changed', `v1=${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`],
    ['two signatures in one header', `v1=${hex},v1=${hex}`],
    ['base64 instead of hex', `v1=${btoa(hex)}`],
  ])('%s', async (_label, signature) => {
    await expect(verify(BODY, headersFor(TS, signature))).resolves.toBe(false)
  })
})
