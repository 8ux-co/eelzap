import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import type { verifyWebhookSignature as VerifyFn } from './webhook'
import { NEAR_MISS_SIGNATURES, VECTOR_SECRET, WEBHOOK_VECTORS } from './webhook.vectors'

/*
 * The vectors again, in an edge-like runtime: `webhook.ts` compiled on its
 * own and evaluated in a bare V8 context holding only what an edge runtime or
 * a worker guarantees — `crypto` (WebCrypto) and `TextEncoder`. No `require`,
 * `process`, `Buffer` or `node:crypto`, so a Node-only path in verify fails
 * here even where the Node tests pass.
 */

const SOURCE = readFileSync(fileURLToPath(new URL('./webhook.ts', import.meta.url)), 'utf8')
const COMPILED = ts.transpileModule(SOURCE, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    removeComments: true,
  },
}).outputText

function loadVerify(globals: Record<string, unknown>): typeof VerifyFn {
  const exports: Record<string, unknown> = {}
  vm.runInContext(COMPILED, vm.createContext({ exports, ...globals }))
  return exports.verifyWebhookSignature as typeof VerifyFn
}

const verify = loadVerify({ crypto: globalThis.crypto, TextEncoder })

const headersFor = (timestamp: number, signature: string) => ({
  'X-Eel-Timestamp': String(timestamp),
  'X-Eel-Signature': signature,
})

describe('webhook vectors in an edge-like runtime', () => {
  it('the module has no runtime import, Node or otherwise', () => {
    expect(COMPILED).not.toMatch(/\brequire\s*\(/)
    expect(COMPILED).not.toMatch(/\bimport\s*\(/)
    expect(COMPILED).not.toMatch(/\b(process|Buffer)\b/)
  })

  it.each(WEBHOOK_VECTORS)('verifies: $name', async (vector) => {
    const at = new Date(vector.timestamp * 1000)
    const headers = headersFor(vector.timestamp, vector.signature)
    await expect(verify(vector.body, headers, vector.secret, { now: at })).resolves.toBe(true)
    await expect(
      verify(vector.body, headers, vector.secret.slice('whsec_'.length), { now: at }),
    ).resolves.toBe(true)
  })

  it('refuses a changed body, secret, timestamp or signature', async () => {
    const [vector] = WEBHOOK_VECTORS
    const { body, timestamp, signature } = vector!
    const now = new Date(timestamp * 1000)
    const ok = headersFor(timestamp, signature)

    await expect(verify(`${body} `, ok, VECTOR_SECRET, { now })).resolves.toBe(false)
    await expect(verify(body, ok, 'whsec_vEctor5TestOnlyNotARealSecret02', { now })).resolves.toBe(
      false,
    )
    await expect(
      verify(body, headersFor(timestamp + 1, signature), VECTOR_SECRET, { now }),
    ).resolves.toBe(false)
    await expect(
      verify(body, ok, VECTOR_SECRET, { now: new Date((timestamp + 301) * 1000) }),
    ).resolves.toBe(false)
    await expect(
      verify(body, headersFor(timestamp, NEAR_MISS_SIGNATURES.prefixKept), VECTOR_SECRET, { now }),
    ).resolves.toBe(false)
    await expect(
      verify(body, headersFor(timestamp, NEAR_MISS_SIGNATURES.bodyOnly), VECTOR_SECRET, { now }),
    ).resolves.toBe(false)
    await expect(
      verify(body, headersFor(timestamp, signature.replace('v1=', '')), VECTOR_SECRET, { now }),
    ).resolves.toBe(false)
    await expect(verify(body, {}, VECTOR_SECRET, { now })).resolves.toBe(false)
  })

  it('fails loudly where there is no WebCrypto, rather than answering false', async () => {
    const [vector] = WEBHOOK_VECTORS
    const bare = loadVerify({ TextEncoder })
    await expect(
      bare(vector!.body, headersFor(vector!.timestamp, vector!.signature), VECTOR_SECRET, {
        now: new Date(vector!.timestamp * 1000),
      }),
    ).rejects.toThrow(/WebCrypto/)
  })
})
