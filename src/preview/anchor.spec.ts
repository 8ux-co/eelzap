import { afterEach, describe, expect, it } from 'vitest'

import {
  buildAnchor,
  buildSelector,
  cssEscape,
  findAnchorElement,
  safeQueryAll,
  textQuoteFor,
} from './anchor'
import type { DomAnchor } from './protocol'
import { TagIndex } from './tags'

function setup(html: string) {
  document.body.innerHTML = html
  const index = new TagIndex(document)
  index.scan()
  return index
}

const $ = (selector: string) => document.querySelector(selector)!

const anchor = (overrides: Partial<DomAnchor>): DomAnchor => ({
  tag: null,
  selector: null,
  textQuote: null,
  rect: { x: 0, y: 0, w: 0, h: 0 },
  viewport: { w: 1280, h: 2000 },
  ...overrides,
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('buildSelector', () => {
  it('builds a short selector that matches exactly the element', () => {
    setup(`<main><article><p>a</p><p>b</p><p>c</p></article><aside><p>z</p></aside></main>`)
    const target = document.querySelectorAll('article p')[1]!
    const selector = buildSelector(target, document)!
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    expect(document.querySelector(selector)).toBe(target)
    // The shortest path that is unique today, not the full chain.
    expect(selector).toBe('p:nth-of-type(2)')
  })

  it('starts from a stable id, and skips framework-generated ids', () => {
    setup(
      `<section id="precios"><div><span>x</span></div></section><aside><div><span>o</span></div></aside><div id=":r1:"><b>y</b></div>`,
    )
    expect(buildSelector($('#precios span'), document)).toBe('#precios > div > span')
    const generated = buildSelector($('b'), document)!
    expect(generated).not.toContain(':r1:')
    expect(document.querySelector(generated)).toBe($('b'))
  })

  it('anchors on a data-zap container when there is no id', () => {
    setup(
      `<article data-zap-entry="blog/a"><p>x</p><p>y</p></article><article data-zap-entry="blog/b"><p>x</p><p>y</p></article>`,
    )
    const target = document.querySelectorAll('article')[1]!.querySelectorAll('p')[1]!
    const selector = buildSelector(target, document)!
    expect(document.querySelector(selector)).toBe(target)
    expect(selector.length).toBeLessThan(80)
  })

  it('escapes identifiers', () => {
    expect(cssEscape('1a b#c')).toBe('\\31 a\\ b\\#c')
  })
})

describe('textQuoteFor', () => {
  it('captures the exact text and up to 32 characters around it', () => {
    setup(`<p>Antes del título largo de verdad</p><h1>Mi   primer
      post</h1><p>Después viene el cuerpo del artículo</p>`)
    expect(textQuoteFor($('h1'), document)).toEqual({
      exact: 'Mi primer post',
      prefix: 'Antes del título largo de verdad'.slice(-32),
      suffix: 'Después viene el cuerpo del artí',
    })
  })

  it('caps exact at 500 characters', () => {
    setup(`<p>${'a'.repeat(900)}</p>`)
    expect(textQuoteFor($('p'), document)!.exact).toHaveLength(500)
  })
})

describe('buildAnchor', () => {
  it('has a field layer for a tagged element and only a dom layer otherwise', () => {
    const index = setup(
      `<h1 data-zap="blog/hola#title" data-zap-locale="es">Hola</h1><footer>Pie</footer>`,
    )
    const tagged = buildAnchor($('h1'), index, 'https://ejemplo.com/blog/hola', document, window)
    expect(tagged.field).toEqual({ recordRef: 'blog/hola', key: 'title', locale: 'es' })
    expect(tagged.dom.tag).toBe('blog/hola#title')
    expect(tagged.pageUrl).toBe('https://ejemplo.com/blog/hola')

    const plain = buildAnchor($('footer'), index, 'https://ejemplo.com/', document, window)
    expect(plain.field).toBeNull()
    expect(plain.dom).toMatchObject({ tag: null, selector: 'footer', textQuote: { exact: 'Pie' } })
  })
})

describe('findAnchorElement', () => {
  it('re-finds by tag first, then selector, then text quote', () => {
    const index = setup(
      `<h1 data-zap="blog/hola#title">Hola</h1><main><p>uno</p><p>Párrafo citado</p></main>`,
    )
    expect(findAnchorElement(anchor({ tag: 'blog/hola#title' }), index, document, window)).toBe(
      $('h1'),
    )
    expect(
      findAnchorElement(anchor({ selector: 'main > p:nth-of-type(2)' }), index, document, window),
    ).toBe(document.querySelectorAll('main p')[1])
    expect(
      findAnchorElement(
        anchor({ textQuote: { exact: 'Párrafo citado', prefix: '', suffix: '' } }),
        index,
        document,
        window,
      ),
    ).toBe(document.querySelectorAll('main p')[1])
  })

  it.each([')(', 'p:has(', '[data-x=', ':not(', '<script>'])(
    'survives a malformed selector %j and falls through to the quote',
    (selector) => {
      const index = setup(`<p>Texto que buscar</p>`)
      expect(() => document.querySelectorAll(selector)).toThrow()
      const found = findAnchorElement(
        anchor({ selector, textQuote: { exact: 'Texto que buscar', prefix: '', suffix: '' } }),
        index,
        document,
        window,
      )
      expect(found).toBe($('p'))
    },
  )

  it('returns null when nothing matches', () => {
    const index = setup(`<p>x</p>`)
    expect(findAnchorElement(anchor({ selector: '#nope' }), index, document, window)).toBeNull()
  })

  it('safeQueryAll never throws', () => {
    expect(safeQueryAll(document, ')(')).toEqual([])
  })
})
