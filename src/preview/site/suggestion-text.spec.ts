import { describe, expect, it } from 'vitest'

import { stegaEncode, stegaMarker } from '../../stega'
import { normalizeText } from '../anchor'
import { editableText, parseProposed, sameValue } from './suggestion'

/**
 * The text the site client reads back from a preview page and compares:
 *
 * - `normalizeText`: stega markers out, whitespace collapsed and trimmed;
 * - `sameValue`: a field left as it was (markers and whitespace aside) is not
 *   a change; numbers compare by value, never against their text;
 * - `editableText`: what an inline edit left in the element, as typed (text
 *   nodes, `<br>` and new blocks as line breaks), never through CSS;
 * - `parseProposed`: a value typed or read from the page never sends a marker.
 */

const INFO = { recordRef: 'posts/hola', fieldKey: 'title', locale: 'es' }
const MARKER = stegaMarker(INFO)

function element(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

describe('normalizeText', () => {
  it('removes stega markers', () => {
    expect(MARKER).not.toBe('')
    expect(normalizeText(stegaEncode('Hola mundo', INFO))).toBe('Hola mundo')
    expect(normalizeText(`Ho${MARKER}la`)).toBe('Hola')
  })

  it('collapses runs of whitespace (spaces, tabs, newlines, nbsp) and trims', () => {
    expect(normalizeText('  Hola \n\t  mundo  ')).toBe('Hola mundo')
  })

  it('collapses whitespace left around a removed marker', () => {
    expect(normalizeText(`Hola ${MARKER} mundo ${MARKER}`)).toBe('Hola mundo')
  })

  it('is empty for blank or marker-only text', () => {
    expect(normalizeText('')).toBe('')
    expect(normalizeText('   \n ')).toBe('')
    expect(normalizeText(MARKER)).toBe('')
  })
})

describe('sameValue', () => {
  it('a value read back with its stega marker is the same value', () => {
    expect(sameValue(stegaEncode('Hola mundo', INFO), 'Hola mundo')).toBe(true)
    expect(sameValue('Hola mundo', stegaEncode('Hola mundo', INFO))).toBe(true)
  })

  it('whitespace differences alone are not a change', () => {
    expect(sameValue('Hola   mundo', ' Hola\nmundo ')).toBe(true)
  })

  it('different text is a change, markers or not', () => {
    expect(sameValue(stegaEncode('Hola mundo', INFO), 'Hola mundos')).toBe(false)
    expect(sameValue('Hola', 'hola')).toBe(false)
  })

  it('empty vs blank vs marker-only are the same; empty vs text is not', () => {
    expect(sameValue('', '   ')).toBe(true)
    expect(sameValue('', MARKER)).toBe(true)
    expect(sameValue('', 'x')).toBe(false)
  })

  it('numbers compare by value and never equal a string', () => {
    expect(sameValue(3, 3)).toBe(true)
    expect(sameValue(3, 3.0)).toBe(true)
    expect(sameValue(3, 4)).toBe(false)
    expect(sameValue(3, '3')).toBe(false)
    expect(sameValue('3', 3)).toBe(false)
  })
})

describe('parseProposed (what sameValue compares)', () => {
  it('drops stega markers from TEXT, URL, LONG_TEXT and NUMBER', () => {
    expect(parseProposed('TEXT', stegaEncode('  Hola  mundo ', INFO))).toEqual({
      ok: true,
      value: 'Hola mundo',
    })
    expect(parseProposed('URL', stegaEncode('https://a.co/x', INFO))).toEqual({
      ok: true,
      value: 'https://a.co/x',
    })
    expect(parseProposed('LONG_TEXT', stegaEncode('Uno\r\nDos ', INFO))).toEqual({
      ok: true,
      value: 'Uno\nDos',
    })
    expect(parseProposed('NUMBER', stegaEncode('12,5', INFO))).toEqual({ ok: true, value: 12.5 })
  })

  it('a LONG_TEXT read back with its marker is not a change', () => {
    const before = parseProposed('LONG_TEXT', stegaEncode('Uno\nDos', INFO))
    const typed = parseProposed('LONG_TEXT', 'Uno\nDos')
    expect(before.ok && typed.ok && sameValue(before.value, typed.value)).toBe(true)
  })

  it('a NUMBER read back with its marker equals the typed number', () => {
    const before = parseProposed('NUMBER', stegaEncode('7', INFO))
    const typed = parseProposed('NUMBER', ' 7 ')
    expect(before.ok && typed.ok && sameValue(before.value, typed.value)).toBe(true)
  })

  it('empty or marker-only NUMBER is invalid', () => {
    expect(parseProposed('NUMBER', '')).toEqual({ ok: false })
    expect(parseProposed('NUMBER', MARKER)).toEqual({ ok: false })
  })
})

describe('editableText', () => {
  it('reads text nodes as typed, through nested inline elements', () => {
    expect(editableText(element('Hola <b>mundo</b> <i>y <u>más</u></i>'))).toBe('Hola mundo y más')
  })

  it('keeps whitespace and markers as they are (normalising is the caller’s job)', () => {
    const host = element('')
    host.append(document.createTextNode(`  Hola  ${MARKER}`))
    expect(editableText(host)).toBe(`  Hola  ${MARKER}`)
    expect(normalizeText(editableText(host))).toBe('Hola')
  })

  it('reads <br> as a line break', () => {
    expect(editableText(element('Uno<br>Dos<br><br>Tres'))).toBe('Uno\nDos\n\nTres')
  })

  it('reads a new div, p or li (what Enter makes) as a line break', () => {
    expect(editableText(element('Uno<div>Dos</div><div>Tres</div>'))).toBe('Uno\nDos\nTres')
    expect(editableText(element('<p>Uno</p><p>Dos</p>'))).toBe('Uno\nDos')
    expect(editableText(element('<ul><li>a</li><li>b</li></ul>'))).toBe('a\nb')
  })

  it('does not double a break: <br> then a block, or a leading block', () => {
    expect(editableText(element('Uno<br><div>Dos</div>'))).toBe('Uno\nDos')
    expect(editableText(element('<div>Uno</div>'))).toBe('Uno')
  })

  it('an empty element yields empty text', () => {
    expect(editableText(element(''))).toBe('')
    expect(editableText(element('<span></span>'))).toBe('')
  })

  it('ignores CSS: an uppercase field reads back as typed', () => {
    const host = element('<span style="text-transform: uppercase">Hola mundo</span>')
    host.style.textTransform = 'uppercase'
    expect(editableText(host)).toBe('Hola mundo')
    expect(sameValue(editableText(host), 'Hola mundo')).toBe(true)
  })

  it('skips comments', () => {
    const host = element('Hola')
    host.append(document.createComment('nota'), document.createTextNode(' mundo'))
    expect(editableText(host)).toBe('Hola mundo')
  })
})
