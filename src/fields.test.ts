import { describe, expect, it } from 'vitest'

import { fields } from './fields'
import { stegaEncode } from './stega'
import type { DocumentDetail } from './types/documents'
import type { ItemDetail } from './types/items'
import type { MediaValue } from './types/common'

/*
 * `./fields` (zap-cms-v2 §2.7). Types as `@8ux-co/eelzap-cli codegen` emits
 * them: `HomeDocument = DocumentDetail<HomeContent>`, `PostItem = ItemDetail<…>`.
 * The `@ts-expect-error` lines are the type tests: `tsc --noEmit` fails if a
 * bad key ever compiles (the directive is then unused).
 */

interface HomeContent {
  hero_title: string
  hero_subtitle: string | null
  hero_image: MediaValue | null
  cta_url: string | null
  visits: number | null
  stat_1: string | null
  stat_2: string | null
  stat_3: string | null
  nav_1_texto: string | null
  nav_1_url: string | null
  nav_2_texto: string | null
  nav_2_url: string | null
  hero_dato_1_valor: number | null
  hero_dato_1_logo: MediaValue | null
}
type HomeDocument = DocumentDetail<HomeContent>

interface PostContent {
  title: string
  cover: MediaValue | null
}
type PostItem = ItemDetail<PostContent>

const IMAGE = {
  id: 'm1',
  url: 'https://cdn.example/hero.jpg',
  alt: 'Hero',
  width: 1200,
  height: 600,
} as unknown as MediaValue

function home(content: Partial<HomeContent> = {}): HomeDocument {
  return {
    key: 'home',
    name: 'Home',
    status: 'PUBLISHED',
    locale: 'es',
    meta: {} as HomeDocument['meta'],
    seo: null,
    content: {
      hero_title: 'Hola',
      hero_subtitle: null,
      hero_image: IMAGE,
      cta_url: 'https://example.com/go',
      visits: 3,
      stat_1: 'Uno',
      stat_2: 'Dos',
      stat_3: 'Tres',
      nav_1_texto: 'Cafés',
      nav_1_url: '/cafes',
      nav_2_texto: null,
      nav_2_url: null,
      hero_dato_1_valor: 1850,
      hero_dato_1_logo: IMAGE,
      ...content,
    },
  }
}

const marked = (text: string, fieldKey: string) =>
  stegaEncode(text, { recordRef: 'doc:home', fieldKey, locale: 'es' })

describe('fields: types (codegen-typed keys)', () => {
  it('rejects keys the record does not have, and non-text keys for text()', () => {
    const f = fields(home())
    // @ts-expect-error — not a field of HomeContent
    f.value('hero_titel')
    // @ts-expect-error — not a field of HomeContent
    f.attrs('nope')
    // @ts-expect-error — `visits` is a number, not text
    f.text('visits')
    // @ts-expect-error — no `title_1`… fields, so `title` is no list prefix
    f.list('title', 2)
    const post = fields({} as PostItem)
    // @ts-expect-error — `hero_title` belongs to another type
    post.text('hero_title')
    expect(f.text('hero_title')).toBe('Hola')
  })

  it('types values from the content', () => {
    const f = fields(home())
    const visits: number | null = f.value('visits')
    const stats: Array<string | null> = f.list('stat', 3).map((s) => s.value())
    const urls: Array<string | null> = f.list('nav', 2).map((nav) => nav.value('url'))
    const datos: Array<number | null> = f.list('hero_dato', 1).map((d) => d.value('valor'))
    expect([visits, stats, urls, datos]).toEqual([
      3,
      ['Uno', 'Dos', 'Tres'],
      ['/cafes', null],
      [1850],
    ])
  })

  it('types slot suffixes from the keys', () => {
    const f = fields(home())
    // @ts-expect-error — `nav_1_link` is not a field: `link` is no suffix of `nav`
    f.list('nav', 2)[0]!.value('link')
    // @ts-expect-error — `nav` has no `nav_1`, `hero` no `hero_1`
    f.list('hero', 1)
    expect(f.list('nav', 1)[0]!.text('texto')).toBe('Cafés')
  })
})

/**
 * Slots of several fields, `prefix_{i}_{suffix}` (Verde Origen's `nav_1_texto`
 * + `nav_1_url`, `dato_1_valor`): before, `list` read `prefix_{i}` only and
 * returned nothing for them.
 */
describe('fields: list over slots of several fields', () => {
  it('reads each suffix of each slot', () => {
    const f = fields(home())
    const [first, second] = f.list('nav', 2)
    expect(first!.key).toBe('nav_1')
    expect(first!.index).toBe(1)
    expect(first!.text('texto')).toBe('Cafés')
    expect(first!.value('url')).toBe('/cafes')
    expect(first!.empty).toBe(false)
    expect(second!.empty).toBe(true)
    expect(f.list('nav', 3)[2]!.empty).toBe(true)
    expect(f.list('hero_dato', 1)[0]!.image('logo').src).toBe('https://cdn.example/hero.jpg')
  })

  it('in preview, text keeps its marker and every suffix tags itself', () => {
    const doc = home({ nav_1_texto: marked('Cafés', 'nav_1_texto') })
    const [nav] = fields(doc).list('nav', 1)
    expect(nav!.text('texto')).toBe(doc.content.nav_1_texto)
    expect(nav!.value('texto')).toBe('Cafés')
    expect(nav!.attrs('url')).toEqual({ 'data-zap': 'doc:home#nav_1_url' })
    expect(nav!.image('url')['data-zap']).toBe('doc:home#nav_1_url')
  })
})

describe('fields: outside preview, plain values and empty attributes', () => {
  it('returns what reading the values directly returns', () => {
    const doc = home()
    const f = fields(doc)
    expect(f.preview).toBe(false)
    expect(f.text('hero_title')).toBe(doc.content.hero_title)
    expect(f.text('hero_subtitle')).toBe('')
    expect(f.value('cta_url')).toBe(doc.content.cta_url)
    expect(f.attrs('cta_url')).toEqual({})
    expect(f.image('hero_image')).toEqual({
      src: 'https://cdn.example/hero.jpg',
      alt: 'Hero',
      width: 1200,
      height: 600,
    })
    expect(f.list('stat', 2).map((s) => [s.key, s.index, s.text(), s.value(), s.attrs()])).toEqual([
      ['stat_1', 1, 'Uno', 'Uno', {}],
      ['stat_2', 2, 'Dos', 'Dos', {}],
    ])
    expect(Object.keys(f.image('hero_image'))).not.toContain('data-zap')
  })

  it('renders byte-identical markup to plain values', () => {
    const doc = home()
    const f = fields(doc)
    const plain = `<h1>${doc.content.hero_title}</h1><a href="${doc.content.cta_url}">x</a>`
    const attrs = (a: Record<string, string | undefined>) =>
      Object.entries(a)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join('')
    const helped = `<h1>${f.text('hero_title')}</h1><a href="${f.value('cta_url')}"${attrs(f.attrs('cta_url'))}>x</a>`
    expect(helped).toBe(plain)
  })
})

describe('fields: in preview', () => {
  const doc = home({ hero_title: marked('Hola', 'hero_title'), stat_1: marked('Uno', 'stat_1') })

  it('detects preview from stega and keeps markers on text', () => {
    const f = fields(doc)
    expect(f.preview).toBe(true)
    expect(f.text('hero_title')).toBe(doc.content.hero_title)
    expect(f.text('hero_title')).not.toBe('Hola')
  })

  it('tags non-text fields and keeps markers out of attributes', () => {
    const f = fields(doc)
    expect(f.attrs('cta_url')).toEqual({ 'data-zap': 'doc:home#cta_url' })
    expect(f.image('hero_image')['data-zap']).toBe('doc:home#hero_image')
    expect(f.value('hero_title')).toBe('Hola')
    const [first, second] = f.list('stat', 2)
    expect(first!.text()).toBe(doc.content.stat_1)
    expect(first!.value()).toBe('Uno')
    expect(first!.attrs()).toEqual({ 'data-zap': 'doc:home#stat_1' })
    expect(second!.text()).toBe('Dos')
  })

  it('names items by collection and slug; `preview` forces either way', () => {
    const post = {
      slug: 'hola',
      collection: { key: 'blog', name: 'Blog' },
      content: { title: 'T', cover: IMAGE },
    } as unknown as PostItem
    expect(fields(post, { preview: true }).attrs('cover')).toEqual({
      'data-zap': 'blog/hola#cover',
    })
    expect(fields(doc, { preview: false }).attrs('cta_url')).toEqual({})
    expect(fields(doc, { preview: false }).text('hero_title')).toBe('Hola')
  })
})
