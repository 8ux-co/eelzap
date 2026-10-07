import { describe, expect, it } from 'vitest'

import { stegaEncode } from '../../stega'
import type { TaggedElement } from '../tags'
import type { FieldInfo } from './api'
import {
  buildDraftBody,
  editKindFor,
  inputSpec,
  parseInput,
  proposableField,
  sameRaw,
} from './suggestion'

/**
 * «Editar» per field type (zap-cms-v2 §3.4): which editor a field gets, the
 * native input's spec, what an input parses to, when two stored values are
 * the same, and the draft body's text for a value that is not text.
 */

function tagged(html = false): TaggedElement {
  return {
    element: document.createElement('span'),
    recordRef: 'blog/hola',
    fieldKey: 'f',
    tag: 'blog/hola#f',
    locale: null,
    html,
    source: 'attr',
  }
}

const field = (type: string, extra: Partial<FieldInfo> = {}): FieldInfo => ({
  type,
  label: 'Campo',
  ...extra,
})

const INFO = { recordRef: 'blog/hola', fieldKey: 'f', locale: null }

describe('editKindFor', () => {
  it.each([
    ['TEXT', 'text'],
    ['LONG_TEXT', 'text'],
    ['URL', 'input'],
    ['NUMBER', 'input'],
    ['INTEGER', 'input'],
    ['CURRENCY', 'input'],
    ['DATE', 'input'],
    ['DATETIME', 'input'],
    ['BOOLEAN', 'switch'],
    ['RICH_TEXT', null],
    ['IMAGE', null],
    ['SOMETHING_NEW', null],
  ])('%s → %s', (type, kind) => {
    expect(editKindFor(tagged(), field(type))).toBe(kind)
  })

  it('ENUM with options is a choice; without options it is edited in Zap', () => {
    expect(editKindFor(tagged(), field('ENUM', { options: [{ id: 'a', label: 'A' }] }))).toBe(
      'choice',
    )
    expect(editKindFor(tagged(), field('ENUM', { options: [] }))).toBeNull()
    expect(editKindFor(tagged(), field('ENUM'))).toBeNull()
  })

  it('an html-tagged element is never edited on the page', () => {
    expect(editKindFor(tagged(true), field('TEXT'))).toBeNull()
    expect(editKindFor(tagged(true), field('BOOLEAN'))).toBeNull()
  })

  it('no element or no field: null', () => {
    expect(editKindFor(null, field('TEXT'))).toBeNull()
    expect(editKindFor(tagged(), null)).toBeNull()
  })
})

describe('proposableField', () => {
  it.each([
    ['TEXT', true],
    ['LONG_TEXT', true],
    ['NUMBER', true],
    ['URL', true],
    ['INTEGER', false],
    ['CURRENCY', false],
    ['ENUM', false],
    ['BOOLEAN', false],
    ['DATE', false],
    ['RICH_TEXT', false],
  ])('%s → %s', (type, ok) => {
    expect(proposableField(tagged(), field(type))).toBe(ok)
  })

  it('never on html', () => {
    expect(proposableField(tagged(true), field('TEXT'))).toBe(false)
  })
})

describe('inputSpec', () => {
  it('INTEGER steps by 1', () => {
    expect(inputSpec(field('INTEGER'), 1750)).toEqual({
      type: 'number',
      text: '1750',
      min: undefined,
      max: undefined,
      step: 1,
    })
  })

  it("NUMBER steps 'any', or by the field's step", () => {
    expect(inputSpec(field('NUMBER'), 1.5)).toMatchObject({ text: '1.5', step: 'any' })
    expect(inputSpec(field('NUMBER', { step: 0.5 }), 2)).toMatchObject({ step: 0.5 })
  })

  it('CURRENCY COP shows major units with two decimals; min and max pass through', () => {
    expect(inputSpec(field('CURRENCY', { currency: 'COP', min: 0, max: 100 }), 4600000)).toEqual({
      type: 'number',
      text: '46000.00',
      min: 0,
      max: 100,
      step: 0.01,
    })
  })

  it('CURRENCY JPY has no decimals', () => {
    expect(inputSpec(field('CURRENCY', { currency: 'JPY' }), 4600)).toMatchObject({
      text: '4600',
      step: 1,
    })
  })

  it('DATE slices to YYYY-MM-DD', () => {
    expect(inputSpec(field('DATE'), '2026-10-12T00:00:00.000Z')).toEqual({
      type: 'date',
      text: '2026-10-12',
    })
  })

  it('DATETIME is the local YYYY-MM-DDTHH:mm', () => {
    const at = new Date(2026, 9, 12, 8, 5, 30)
    expect(inputSpec(field('DATETIME'), at.toISOString())).toEqual({
      type: 'datetime-local',
      text: '2026-10-12T08:05',
    })
  })

  it("null is ''", () => {
    for (const type of ['NUMBER', 'INTEGER', 'CURRENCY', 'DATE', 'DATETIME']) {
      expect(inputSpec(field(type, { currency: 'COP' }), null).text).toBe('')
    }
  })
})

describe('parseInput', () => {
  it('empty is null (cleared)', () => {
    for (const type of ['NUMBER', 'INTEGER', 'CURRENCY', 'DATE', 'DATETIME']) {
      expect(parseInput(field(type), '  ')).toEqual({ ok: true, value: null })
    }
  })

  it('INTEGER refuses 1.5 and takes 1760', () => {
    expect(parseInput(field('INTEGER'), '1.5')).toEqual({ ok: false })
    expect(parseInput(field('INTEGER'), '1760')).toEqual({ ok: true, value: 1760 })
  })

  it("NUMBER takes '1,5' as 1.5 and refuses words", () => {
    expect(parseInput(field('NUMBER'), '1,5')).toEqual({ ok: true, value: 1.5 })
    expect(parseInput(field('NUMBER'), 'doce')).toEqual({ ok: false })
  })

  it("CURRENCY '46000.5' COP is 4600050 minor units", () => {
    expect(parseInput(field('CURRENCY', { currency: 'COP' }), '46000.5')).toEqual({
      ok: true,
      value: 4600050,
    })
  })

  it('DATE needs YYYY-MM-DD', () => {
    expect(parseInput(field('DATE'), '2026-10-12')).toEqual({ ok: true, value: '2026-10-12' })
    expect(parseInput(field('DATE'), '12/10/2026')).toEqual({ ok: false })
  })

  it('DATETIME becomes ISO', () => {
    const local = '2026-10-12T08:05'
    expect(parseInput(field('DATETIME'), local)).toEqual({
      ok: true,
      value: new Date(local).toISOString(),
    })
    expect(parseInput(field('DATETIME'), 'mañana')).toEqual({ ok: false })
  })

  it('strips stega markers', () => {
    expect(parseInput(field('INTEGER'), stegaEncode('1760', INFO))).toEqual({
      ok: true,
      value: 1760,
    })
    expect(parseInput(field('URL'), stegaEncode('https://ejemplo.com', INFO))).toEqual({
      ok: true,
      value: 'https://ejemplo.com',
    })
  })
})

describe('sameRaw', () => {
  it('text compares normalized', () => {
    expect(sameRaw('ENUM', stegaEncode('a  b', INFO), 'a b')).toBe(true)
    expect(sameRaw('ENUM', 'a', 'b')).toBe(false)
  })

  it('DATETIME compares to the minute', () => {
    expect(sameRaw('DATETIME', '2026-10-12T08:05:42.000Z', '2026-10-12T08:05:00.000Z')).toBe(true)
    expect(sameRaw('DATETIME', '2026-10-12T08:05:42.000Z', '2026-10-12T08:06:00.000Z')).toBe(false)
  })

  it('numbers, booleans and null exactly; undefined is null', () => {
    expect(sameRaw('INTEGER', 1760, 1760)).toBe(true)
    expect(sameRaw('INTEGER', 1760, 1761)).toBe(false)
    expect(sameRaw('BOOLEAN', true, true)).toBe(true)
    expect(sameRaw('BOOLEAN', false, true)).toBe(false)
    expect(sameRaw('INTEGER', null, null)).toBe(true)
    expect(sameRaw('INTEGER', undefined, null)).toBe(true)
    expect(sameRaw('INTEGER', undefined, 0)).toBe(false)
    expect(sameRaw('BOOLEAN', null, false)).toBe(false)
  })
})

describe('buildDraftBody with display', () => {
  const base = {
    recordRef: 'blog/hola',
    pageUrl: 'https://ejemplo.com/blog/hola',
    anchors: [],
  }

  it("uses display as the body (an option's label), the id as the value", () => {
    const body = buildDraftBody({
      ...base,
      proposal: { fieldKey: 'estado', locale: null, value: 'opt_2' },
      display: 'Agotado',
    })
    expect(body.body).toBe('Agotado')
    expect(body.proposedValues).toEqual([{ fieldKey: 'estado', value: 'opt_2' }])
  })

  it('a boolean says «Sí» or «No»; without display the value is the body', () => {
    expect(
      buildDraftBody({
        ...base,
        proposal: { fieldKey: 'activo', locale: null, value: false },
        display: 'No',
      }).body,
    ).toBe('No')
    expect(
      buildDraftBody({ ...base, proposal: { fieldKey: 'altitud', locale: null, value: 1760 } })
        .body,
    ).toBe('1760')
  })
})
