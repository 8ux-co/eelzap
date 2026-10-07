import { describe, expect, it, vi } from 'vitest'

import { saveToDraft, type DraftBody } from './api'

/**
 * `call()`'s 409 rule through `saveToDraft`: 409 `NO_CHANGE` (the draft
 * already holds that value) is `unchanged`, never a failure the UI words;
 * any other 409 is `invalid`.
 */

const ZAP = 'https://zap.eel.software'
const BODY: DraftBody = {
  collection: 'cafes',
  slug: 'finca',
  pageUrl: 'https://ejemplo.com/cafes/finca',
  anchors: [],
  body: 'Agotado',
  proposedValues: [{ fieldKey: 'estado', value: 'agotado' }],
}

function answer(response: Response) {
  const fetch = vi.fn(async () => response)
  return { ctx: { win: { fetch } as unknown as Window, zapOrigin: ZAP }, fetch }
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status })

describe('saveToDraft and 409', () => {
  it('409 NO_CHANGE is { ok: false, kind: "unchanged" }', async () => {
    const { ctx, fetch } = answer(
      json({ error: { code: 'NO_CHANGE', message: 'Sin cambios' } }, 409),
    )
    expect(await saveToDraft(ctx, 'tok', BODY, 'key')).toEqual({ ok: false, kind: 'unchanged' })
    expect(fetch).toHaveBeenCalledWith(
      `${ZAP}/api/public/v1/comments/save-to-draft`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('409 with another code is invalid', async () => {
    const { ctx } = answer(json({ error: { code: 'DUPLICATE' } }, 409))
    expect(await saveToDraft(ctx, 'tok', BODY, 'key')).toEqual({ ok: false, kind: 'invalid' })
  })

  it('409 without a JSON body is invalid', async () => {
    const { ctx } = answer(new Response('conflict', { status: 409 }))
    expect(await saveToDraft(ctx, 'tok', BODY, 'key')).toEqual({ ok: false, kind: 'invalid' })
  })

  it('NO_CHANGE only counts on a 409', async () => {
    const { ctx } = answer(json({ error: { code: 'NO_CHANGE' } }, 400))
    expect(await saveToDraft(ctx, 'tok', BODY, 'key')).toEqual({ ok: false, kind: 'invalid' })
  })

  it('a 201 is the saved thread', async () => {
    const { ctx } = answer(json({ thread: { id: 't' }, draftVersionId: 'v' }, 201))
    expect(await saveToDraft(ctx, 'tok', BODY, 'key')).toEqual({
      ok: true,
      data: { thread: { id: 't' }, draftVersionId: 'v' },
    })
  })
})
