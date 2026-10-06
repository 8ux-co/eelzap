import { describe, expect, it } from 'vitest'

import { cleanStega, hasStega, splitStega, stegaDecode, stegaEncode, stegaMarker } from './stega'

/** The stega codec (zap-cms-v2 §2.4, §7.5). */

const INFO = { recordRef: 'blog-posts/mi-primer-post', fieldKey: 'title', locale: 'es' }
const ZERO_WIDTH = /^[​‌‍⁠]+$/

describe('stega codec', () => {
  it('round-trips record, field and locale, invisibly', () => {
    const value = stegaEncode('Mi primer post', INFO)
    expect(value.startsWith('Mi primer post')).toBe(true)
    expect(value.slice('Mi primer post'.length)).toMatch(ZERO_WIDTH)
    expect(stegaDecode(value)).toEqual([
      {
        recordRef: 'blog-posts/mi-primer-post',
        fieldKey: 'title',
        locale: 'es',
        tag: 'blog-posts/mi-primer-post#title',
      },
    ])
  })

  it('round-trips documents and values without a locale', () => {
    const value = stegaEncode('', { recordRef: 'doc:home', fieldKey: 'hero_title' })
    expect(stegaDecode(value)).toEqual([
      { recordRef: 'doc:home', fieldKey: 'hero_title', locale: null, tag: 'doc:home#hero_title' },
    ])
  })

  it('decodes several markers in one string, in order', () => {
    const text =
      stegaEncode('Ana', { recordRef: 'team/ana', fieldKey: 'name' }) +
      ' ' +
      stegaEncode('CEO', { recordRef: 'team/ana', fieldKey: 'role', locale: 'pt-BR' })
    expect(stegaDecode(text).map((d) => `${d.tag}@${d.locale}`)).toEqual([
      'team/ana#name@null',
      'team/ana#role@pt-BR',
    ])
  })

  it('refuses info outside the tag grammar, and never double-encodes', () => {
    expect(stegaMarker({ recordRef: 'Blog/Post', fieldKey: 'title' })).toBe('')
    expect(stegaMarker({ recordRef: 'blog/post', fieldKey: 'Title' })).toBe('')
    expect(stegaMarker({ recordRef: 'blog/post', fieldKey: 'title', locale: 'x y' })).toBe('')
    const once = stegaEncode('Hola', INFO)
    expect(stegaEncode(once, { ...INFO, fieldKey: 'other' })).toBe(once)
  })

  it('ignores garbage: lone zero-width characters, a truncated or tampered marker', () => {
    expect(stegaDecode('a​b‍c')).toEqual([])
    const marker = stegaMarker(INFO)
    expect(stegaDecode(`x${marker.slice(0, marker.length - 4)}`)).toEqual([])
    // Flip one digit inside the payload: the result no longer parses.
    const tampered = marker.slice(0, 20) + '⁠' + marker.slice(21)
    expect(stegaDecode(`x${tampered}`).map((d) => d.tag)).not.toContain(
      'blog-posts/mi-primer-post#title',
    )
  })

  it('leaves emoji joiners alone', () => {
    const family = '👨‍👩‍👧'
    expect(hasStega(family)).toBe(false)
    expect(cleanStega(family)).toBe(family)
    expect(cleanStega(stegaEncode(family, INFO))).toBe(family)
  })
})

describe('cleanStega', () => {
  it('cleans strings, arrays and plain objects deeply, and nothing else', () => {
    const title = stegaEncode('Hola', INFO)
    expect(cleanStega(title)).toBe('Hola')
    expect(cleanStega([title, 1, null])).toEqual(['Hola', 1, null])
    expect(cleanStega({ a: { b: title }, n: 2 })).toEqual({ a: { b: 'Hola' }, n: 2 })
    const date = new Date(0)
    expect(cleanStega(date)).toBe(date)
    expect(cleanStega(42)).toBe(42)
  })

  it('returns an unmarked string as is', () => {
    expect(cleanStega('plain')).toBe('plain')
    expect(hasStega('plain')).toBe(false)
    expect(hasStega(stegaEncode('x', INFO))).toBe(true)
    expect(hasStega(5)).toBe(false)
  })

  it('splitStega keeps the markers apart from the text', () => {
    const value = stegaEncode('Hola', INFO)
    const { text, markers } = splitStega(value)
    expect(text).toBe('Hola')
    expect(markers).toBe(stegaMarker(INFO))
    expect(splitStega('x')).toEqual({ text: 'x', markers: '' })
  })
})
