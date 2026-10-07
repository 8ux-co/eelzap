// @vitest-environment node
import { createElement, Fragment } from 'react'
// @ts-ignore -- react-dom is a dev dependency here; its types resolve only where `@types/react-dom` is hoisted, so neither ts-expect-error nor a plain import typechecks in every project.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { fields } from './fields'
import { ZapPreview } from './next'
import { hasStega, stegaEncode } from './stega'

/**
 * The byte-identical guarantee of live-site «Editar» (ADR 041 amendment
 * 2026-10-06): a visitor without the draft cookie gets the published HTML,
 * with NO `data-zap` and NO stega, and the boot adds no markup at all. Only a
 * draft-mode render (the browser holding the cookie, where the delivery
 * answers with stega) is tagged. The draft render below is the control: it
 * proves the assertions would fail if tags leaked into the published page.
 */

const SITE_ID = '0b5c9a8e-3f1d-4c2b-9a7e-1d2c3b4a5f6e'

/** A delivered document, as the published API answers it: plain strings. */
const published = {
  key: 'inicio',
  content: { titulo: 'Café de origen', cta_url: 'https://verdeorigen.co/cafes' },
}

/** The same document as a draft-mode read answers it: text carries its stega marker. */
const draft = {
  key: 'inicio',
  content: {
    titulo: stegaEncode('Café de origen', { recordRef: 'doc:inicio', fieldKey: 'titulo' }),
    cta_url: 'https://verdeorigen.co/cafes',
  },
}

function page(record: typeof published, boot: boolean, preview: boolean): string {
  const f = fields(record)
  return (renderToStaticMarkup as (element: unknown) => string)(
    createElement(
      Fragment,
      null,
      createElement('h1', f.attrs('titulo'), f.text('titulo')),
      createElement('a', { href: f.value('cta_url'), ...f.attrs('cta_url') }, 'Ver cafés'),
      boot ? createElement(ZapPreview, { siteKey: 'verdeorigen', siteId: SITE_ID, preview }) : null,
    ),
  )
}

describe('a published render (no draft cookie) is untagged and unchanged', () => {
  it('carries no data-zap and no stega', () => {
    const html = page(published, true, false)
    expect(html).not.toContain('data-zap')
    expect(hasStega(html)).toBe(false)
    expect(html).toBe('<h1>Café de origen</h1><a href="https://verdeorigen.co/cafes">Ver cafés</a>')
  })

  it('is byte-identical with and without the boot: the bar ships no markup', () => {
    expect(page(published, true, false)).toBe(page(published, false, false))
  })

  it('control: a draft-mode render IS tagged, so the assertions above can fail', () => {
    const html = page(draft, true, true)
    expect(html).toContain('data-zap="doc:inicio#titulo"')
    expect(hasStega(html)).toBe(true)
    expect(html).not.toBe(page(published, true, false))
  })
})
