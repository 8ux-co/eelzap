import { afterEach, describe, expect, it } from 'vitest'

import { splitStega, stegaEncode } from '../stega'
import { TagIndex } from './tags'
import { ValueApplier } from './values'

const REF = 'blog/hola'

function setup(html: string) {
  document.body.innerHTML = html
  const index = new TagIndex(document)
  index.scan()
  return { index, values: new ValueApplier(index, document) }
}

const $ = (selector: string) => document.querySelector(selector)!

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ValueApplier', () => {
  it('writes text, numbers and null as textContent', () => {
    const { values } = setup(`
      <h1 data-zap="${REF}#title">Viejo <em>título</em></h1>
      <span data-zap="${REF}#price">0</span>
      <p data-zap="${REF}#subtitle">algo</p>
    `)
    const written = values.apply({
      recordRef: REF,
      locale: 'es',
      patch: { title: 'Nuevo <b>título</b>', price: '12.500 COP', subtitle: null },
    })
    expect(written).toBe(3)
    // Markup in a text value is text, never parsed.
    expect($('h1').innerHTML).toBe('Nuevo &lt;b&gt;título&lt;/b&gt;')
    expect($('span').textContent).toBe('12.500 COP')
    expect($('p').textContent).toBe('')
  })

  it('substitutes HTML only on data-zap-html elements, sanitised', () => {
    const { values } = setup(`
      <div data-zap="${REF}#body" data-zap-html><p>viejo</p></div>
      <div data-zap="${REF}#body" id="plain"><p>viejo</p></div>
    `)
    values.apply({
      recordRef: REF,
      locale: 'es',
      patch: {
        body: { html: '<p onclick="x()">Hola <strong>mundo</strong><script>steal()</script></p>' },
      },
    })
    expect($('[data-zap-html]').innerHTML).toBe('<p>Hola <strong>mundo</strong></p>')
    expect($('#plain').innerHTML).toBe('Hola mundo')
  })

  it('writes src, srcset and alt for images, and only safe URLs', () => {
    const { values } = setup(`
      <img data-zap="${REF}#cover" src="https://cdn.example/old.jpg" srcset="https://cdn.example/old-2x.jpg 2x" alt="old">
      <picture data-zap="doc:home#hero"><source srcset="https://cdn.example/old.webp"><img src="https://cdn.example/old.jpg"></picture>
    `)
    values.apply({
      recordRef: REF,
      locale: 'es',
      patch: { cover: { image: { src: 'https://cdn.example/new.jpg', alt: 'Nueva' } } },
    })
    const img = $('img[data-zap]')
    expect(img.getAttribute('src')).toBe('https://cdn.example/new.jpg')
    expect(img.hasAttribute('srcset')).toBe(false) // a stale srcset would win
    expect(img.getAttribute('alt')).toBe('Nueva')

    values.apply({
      recordRef: 'doc:home',
      locale: 'es',
      patch: { hero: { image: { src: 'https://cdn.example/hero.jpg' } } },
    })
    expect($('picture img').getAttribute('src')).toBe('https://cdn.example/hero.jpg')
    expect($('picture source').hasAttribute('srcset')).toBe(false)

    for (const src of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>']) {
      values.apply({ recordRef: REF, locale: 'es', patch: { cover: { image: { src } } } })
      expect(img.getAttribute('src')).toBe('https://cdn.example/new.jpg')
    }
    values.apply({
      recordRef: REF,
      locale: 'es',
      patch: { cover: { image: { srcset: 'https://a/1.jpg 1x, javascript:alert(1) 2x' } } },
    })
    expect(img.hasAttribute('srcset')).toBe(false)
  })

  it('a text value on an image sets its alt, nothing else', () => {
    const { values } = setup(`<img data-zap="${REF}#cover_alt" src="https://cdn.example/a.jpg">`)
    values.apply({ recordRef: REF, locale: 'es', patch: { cover_alt: 'Texto alternativo' } })
    expect($('img').getAttribute('alt')).toBe('Texto alternativo')
    expect($('img').getAttribute('src')).toBe('https://cdn.example/a.jpg')
  })

  it('leaves elements pinned to another locale alone', () => {
    const { values } = setup(`
      <h1 data-zap="${REF}#title" data-zap-locale="en">Hello</h1>
      <h1 data-zap="${REF}#title" data-zap-locale="es" id="es">Hola</h1>
      <h1 data-zap="${REF}#title" id="any">?</h1>
    `)
    values.apply({ recordRef: REF, locale: 'es', patch: { title: 'Nuevo' } })
    expect($('[data-zap-locale="en"]').textContent).toBe('Hello')
    expect($('#es').textContent).toBe('Nuevo')
    expect($('#any').textContent).toBe('Nuevo')
  })

  it('re-applies after the site re-renders a node, and settles (no rewrite when equal)', () => {
    const { index, values } = setup(`<main><h1 data-zap="${REF}#title">Viejo</h1></main>`)
    values.apply({ recordRef: REF, locale: 'es', patch: { title: 'Nuevo' } })
    expect(values.reapply()).toBe(0)

    // The site replaces the node (hydration, client routing).
    $('main').innerHTML = `<h1 data-zap="${REF}#title">Viejo</h1>`
    index.scan()
    expect(values.reapply()).toBe(1)
    expect($('h1').textContent).toBe('Nuevo')
    expect(values.reapply()).toBe(0)
  })

  it('re-applies rich text when the site overwrote our output', () => {
    const { values } = setup(`<div data-zap="${REF}#body" data-zap-html></div>`)
    values.apply({ recordRef: REF, locale: 'es', patch: { body: { html: '<p>A</p>' } } })
    expect(values.reapply()).toBe(0)
    $('div').innerHTML = '<p>site</p>'
    expect(values.reapply()).toBe(1)
    expect($('div').innerHTML).toBe('<p>A</p>')
  })
})

/**
 * URL and EMAIL fields (`links` capability): the editor sends `{ url }` and
 * `{ email }`, and the page writes the link's `href`, never over its label.
 * Before, `<a href={f.value('cta_url')} {...f.attrs('cta_url')}>Ver más</a>`
 * showed "/CAFES" as its text.
 */
describe('ValueApplier: URL and EMAIL fields go to href, not text', () => {
  it('a URL field on a link: href changes, the label stays', () => {
    const { values } = setup(`<a href="/cafes" data-zap="${REF}#cta_url">Ver más</a>`)
    expect(
      values.apply({ recordRef: REF, locale: 'es', patch: { cta_url: { url: '/CAFES' } } }),
    ).toBe(1)
    expect($('a').getAttribute('href')).toBe('/CAFES')
    expect($('a').textContent).toBe('Ver más')
    // Settles: writing it again changes nothing.
    expect(values.reapply()).toBe(0)
  })

  it('an EMAIL field on a link becomes a mailto: href, the label stays', () => {
    const { values } = setup(`<a href="mailto:a@b.co" data-zap="${REF}#email">Escríbenos</a>`)
    values.apply({ recordRef: REF, locale: 'es', patch: { email: { email: 'hola@verde.co' } } })
    expect($('a').getAttribute('href')).toBe('mailto:hola@verde.co')
    expect($('a').textContent).toBe('Escríbenos')
  })

  it('a tag on a wrapper writes its first link', () => {
    const { values } = setup(`<li data-zap="${REF}#cta_url"><a href="/a">Ir</a></li>`)
    values.apply({ recordRef: REF, locale: 'es', patch: { cta_url: { url: '/b' } } })
    expect($('a').getAttribute('href')).toBe('/b')
    expect($('li').textContent).toBe('Ir')
  })

  it('refuses unsafe schemes', () => {
    const { values } = setup(`<a href="/a" data-zap="${REF}#x">Ir</a>`)
    values.apply({ recordRef: REF, locale: 'es', patch: { x: { url: 'javascript:alert(1)' } } })
    expect($('a').getAttribute('href')).toBe('/a')
  })

  it('with no link to write, the address is the text', () => {
    const { values } = setup(`<span data-zap="${REF}#email">a@b.co</span>`)
    values.apply({ recordRef: REF, locale: 'es', patch: { email: { email: 'c@d.co' } } })
    expect($('span').textContent).toBe('c@d.co')
  })

  it('a marked text node takes the address as text', () => {
    const { values } = setup(
      `<p>${stegaEncode('a@b.co', { recordRef: REF, fieldKey: 'email', locale: 'es' })}</p>`,
    )
    values.apply({ recordRef: REF, locale: 'es', patch: { email: { email: 'c@d.co' } } })
    expect(splitStega($('p').textContent!).text).toBe('c@d.co')
  })
})

describe('ValueApplier: stega-found elements (zap-cms-v2 §2.4)', () => {
  const mark = (text: string, fieldKey: string) => stegaEncode(text, { recordRef: REF, fieldKey })

  it('writes only the marked text node, keeps its marker, leaves the rest of the element alone', () => {
    const { index, values } = setup(`<p id="p">Precio: <b>caro</b> ${mark('Viejo', 'title')}</p>`)
    expect(values.apply({ recordRef: REF, locale: 'es', patch: { title: 'Nuevo' } })).toBe(1)
    const p = $('#p')
    expect(splitStega(p.textContent!).text).toBe('Precio: caro Nuevo')
    expect(p.querySelector('b')!.textContent).toBe('caro')
    index.scan()
    expect(index.byField(REF, 'title')).toHaveLength(1)
    // Settled: the same value again writes nothing.
    expect(values.reapply()).toBe(0)
  })

  it('leaves rich text and images found by a marker to the site', () => {
    const { values } = setup(`<p>${mark('Texto', 'body')}</p>`)
    expect(
      values.apply({ recordRef: REF, locale: 'es', patch: { body: { html: '<b>x</b>' } } }),
    ).toBe(0)
    expect(
      values.apply({
        recordRef: REF,
        locale: 'es',
        patch: { body: { image: { src: 'https://cdn.example/a.jpg' } } },
      }),
    ).toBe(0)
    expect(splitStega($('p').textContent!).text).toBe('Texto')
  })
})
