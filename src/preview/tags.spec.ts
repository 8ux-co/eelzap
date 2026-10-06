import { afterEach, describe, expect, it, vi } from 'vitest'

import { stegaEncode } from '../stega'
import { observeTags, TagIndex } from './tags'

function page(html: string): Document {
  document.body.innerHTML = html
  return document
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TagIndex', () => {
  it('indexes both grammars, with locale and html opt-in', () => {
    const doc = page(`
      <h1 data-zap="blog-posts/mi-primer-post#title">Mi primer post</h1>
      <p data-zap="doc:home#hero_subtitle">Logística</p>
      <section data-zap-locale="en">
        <article data-zap-entry="blog-posts/mi-primer-post">
          <h2 data-zap-field="title">My first post</h2>
          <img data-zap-field="cover" src="https://cdn.example/a.jpg" />
          <div data-zap-field="body" data-zap-html><p>Body</p></div>
        </article>
      </section>
    `)
    const index = new TagIndex(doc)
    index.scan()
    expect(index.elements.map((t) => [t.tag, t.locale, t.html])).toEqual([
      ['blog-posts/mi-primer-post#title', null, false],
      ['doc:home#hero_subtitle', null, false],
      ['blog-posts/mi-primer-post#title', 'en', false],
      ['blog-posts/mi-primer-post#cover', 'en', false],
      ['blog-posts/mi-primer-post#body', 'en', true],
    ])
    expect(index.byField('blog-posts/mi-primer-post', 'title')).toHaveLength(2)
    expect(index.summary()).toEqual([
      {
        tag: 'blog-posts/mi-primer-post#body',
        recordRef: 'blog-posts/mi-primer-post',
        fieldKey: 'body',
        count: 1,
        source: 'attr',
      },
      {
        tag: 'blog-posts/mi-primer-post#cover',
        recordRef: 'blog-posts/mi-primer-post',
        fieldKey: 'cover',
        count: 1,
        source: 'attr',
      },
      {
        tag: 'blog-posts/mi-primer-post#title',
        recordRef: 'blog-posts/mi-primer-post',
        fieldKey: 'title',
        count: 2,
        source: 'attr',
      },
      {
        tag: 'doc:home#hero_subtitle',
        recordRef: 'doc:home',
        fieldKey: 'hero_subtitle',
        count: 1,
        source: 'attr',
      },
    ])
    expect(index.problems).toEqual([])
  })

  it('lets data-zap win over data-zap-field on the same element', () => {
    const doc = page(
      `<div data-zap-entry="blog/a"><h1 data-zap="doc:home#title" data-zap-field="other">x</h1></div>`,
    )
    const index = new TagIndex(doc)
    index.scan()
    expect(index.elements.map((t) => t.tag)).toEqual(['doc:home#title'])
  })

  it('reports invalid tags as problems and never indexes them', () => {
    const doc = page(`
      <h1 data-zap="Blog/x#title">a</h1>
      <h2 data-zap-field="title">orphan field</h2>
      <div data-zap-entry="not a ref"><p data-zap-field="body">b</p></div>
      <p data-zap-field="Bad Key">c</p>
    `)
    const index = new TagIndex(doc)
    index.scan()
    expect(index.elements).toEqual([])
    expect(index.problems).toEqual([
      { attribute: 'data-zap', value: 'Blog/x#title' },
      { attribute: 'data-zap-entry', value: '' },
      { attribute: 'data-zap-entry', value: 'not a ref' },
      { attribute: 'data-zap-field', value: 'Bad Key' },
    ])
  })

  it('finds the nearest tagged ancestor of a click target', () => {
    const doc = page(
      `<h1 data-zap="blog/x#title"><span><b id="t">deep</b></span></h1><p id="u">x</p>`,
    )
    const index = new TagIndex(doc)
    index.scan()
    expect(index.closest(doc.getElementById('t'))?.tag).toBe('blog/x#title')
    expect(index.closest(doc.getElementById('u'))).toBeNull()
  })
})

describe('observeTags', () => {
  it('re-indexes after mutations, one callback per burst', async () => {
    const doc = page(`<main></main>`)
    const timers: Array<() => void> = []
    const onChange = vi.fn()
    const stop = observeTags(doc.body, onChange, {
      throttleMs: 200,
      setTimeout: (fn) => timers.push(fn),
      clearTimeout: () => {},
    })
    const main = doc.querySelector('main')!
    for (let i = 0; i < 50; i++) {
      const p = doc.createElement('p')
      p.setAttribute('data-zap', `blog/x#f${i}`)
      main.appendChild(p)
    }
    await Promise.resolve() // MutationObserver delivers in a microtask
    expect(timers).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
    timers.shift()!()
    expect(onChange).toHaveBeenCalledTimes(1)

    const index = new TagIndex(doc)
    index.scan()
    expect(index.elements).toHaveLength(50)

    // An attribute change to a tag is a mutation too.
    main.firstElementChild!.setAttribute('data-zap', 'blog/x#renamed')
    await Promise.resolve()
    expect(timers).toHaveLength(1)
    stop()
  })

  it('ignores mutations inside the overlay host', async () => {
    const doc = page(`<main></main>`)
    const host = doc.createElement('eel-zap-overlay')
    doc.documentElement.appendChild(host)
    const timers: Array<() => void> = []
    const stop = observeTags(doc.documentElement, () => {}, {
      setTimeout: (fn) => timers.push(fn),
      ignore: (node) => node === host || host.contains(node),
    })
    host.appendChild(doc.createElement('div'))
    await Promise.resolve()
    expect(timers).toHaveLength(0)
    doc.querySelector('main')!.appendChild(doc.createElement('p'))
    await Promise.resolve()
    expect(timers).toHaveLength(1)
    stop()
    host.remove()
  })
})

/**
 * Stega (zap-cms-v2 §2.4): text fields read in preview carry an invisible
 * marker; the index finds their elements with no manual tag.
 */
describe('TagIndex: stega', () => {
  const mark = (text: string, recordRef: string, fieldKey: string, locale?: string) =>
    stegaEncode(text, { recordRef, fieldKey, locale })

  it('finds the element that renders each marked text, in lists and cards too', () => {
    const doc = page(`
      <h1>${mark('Hola', 'doc:home', 'hero_title', 'es')}</h1>
      <ul>
        <li><span>${mark('Uno', 'blog/uno', 'title')}</span></li>
        <li><span>${mark('Dos', 'blog/dos', 'title')}</span></li>
      </ul>
      <p>Sin marcador</p>
    `)
    const index = new TagIndex(doc)
    index.scan()
    expect(index.elements.map((t) => [t.element.localName, t.tag, t.locale, t.source])).toEqual([
      ['h1', 'doc:home#hero_title', 'es', 'stega'],
      ['span', 'blog/uno#title', null, 'stega'],
      ['span', 'blog/dos#title', null, 'stega'],
    ])
    expect(index.closest(doc.querySelector('li span'))?.tag).toBe('blog/uno#title')
    expect(index.summary().map((s) => [s.tag, s.source])).toEqual([
      ['blog/dos#title', 'stega'],
      ['blog/uno#title', 'stega'],
      ['doc:home#hero_title', 'stega'],
    ])
  })

  it('a manual tag on the same element wins over its marker', () => {
    const doc = page(`<h1 data-zap="doc:home#cta">${mark('Hola', 'doc:home', 'hero_title')}</h1>`)
    const index = new TagIndex(doc)
    index.scan()
    expect(index.elements.map((t) => [t.tag, t.source])).toEqual([['doc:home#cta', 'attr']])
    expect(index.byField('doc:home', 'hero_title')).toEqual([])
  })

  it('a field found both ways reports attr; document order is kept across both', () => {
    const doc = page(`
      <p>${mark('Hola', 'doc:home', 'title')}</p>
      <h2 data-zap="doc:home#title">Hola</h2>
    `)
    const index = new TagIndex(doc)
    index.scan()
    expect(index.elements.map((t) => t.element.localName)).toEqual(['p', 'h2'])
    expect(index.summary()).toEqual([
      { tag: 'doc:home#title', recordRef: 'doc:home', fieldKey: 'title', count: 2, source: 'attr' },
    ])
  })

  it('never indexes text in head, script, style, template or textarea', () => {
    document.title = mark('Título', 'doc:home', 'seo_title')
    const doc = page(`
      <script>var x = "${mark('a', 'doc:home', 'a')}"</script>
      <style>/* ${mark('b', 'doc:home', 'b')} */</style>
      <template><p>${mark('c', 'doc:home', 'c')}</p></template>
      <textarea>${mark('d', 'doc:home', 'd')}</textarea>
    `)
    const index = new TagIndex(doc)
    index.scan()
    expect(index.elements).toEqual([])
    document.title = ''
  })

  it('ignores zero-width characters that are not a valid marker', () => {
    const doc = page(`<p>a\u200Bb\u200C\u200D\u2060</p>`)
    const index = new TagIndex(doc)
    index.scan()
    expect(index.elements).toEqual([])
  })
})
