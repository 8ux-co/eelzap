import { describe, expect, it } from 'vitest'

import {
  envelope,
  isDraftRoutePath,
  isPreviewValue,
  MAX_LABELS,
  MAX_MESSAGE_BYTES,
  parseEditorMessage,
  parsePageMessage,
  parseRecordRef,
  parseTag,
} from './protocol'

const SESSION = '0123456789abcdef0123456789abcdef'

const hello = {
  session: SESSION,
  siteKey: 'main',
  locale: 'es',
  labels: { title: 'Título' },
  recordRef: 'blog-posts/mi-primer-post',
  mode: 'inspect',
}

const domAnchor = {
  tag: 'blog-posts/mi-primer-post#title',
  selector: 'main > h1',
  textQuote: { exact: 'Mi primer post', prefix: '', suffix: '' },
  rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.05 },
  viewport: { w: 1280, h: 2200 },
}

describe('tag grammar', () => {
  it('parses entry and document tags', () => {
    expect(parseTag('blog-posts/mi-primer-post#title')).toEqual({
      recordRef: 'blog-posts/mi-primer-post',
      fieldKey: 'title',
    })
    expect(parseTag(' doc:home#hero_subtitle ')).toEqual({
      recordRef: 'doc:home',
      fieldKey: 'hero_subtitle',
    })
    expect(parseRecordRef('doc:home')).toEqual({ kind: 'document', key: 'home' })
    expect(parseRecordRef('blog/hola')).toEqual({ kind: 'entry', collection: 'blog', slug: 'hola' })
  })

  it.each([
    'blog-posts/mi-primer-post',
    '#title',
    'blog-posts#title',
    'Blog/x#title',
    'blog/x#Title',
    'blog/x/y#title',
    'doc:#title',
    'doc:home#',
    'blog/x#ti tle',
    'javascript:alert(1)#x',
  ])('refuses %j', (value) => {
    expect(parseTag(value)).toBeNull()
  })
})

describe('parseEditorMessage', () => {
  it('accepts a valid hello and keeps only envelope fields', () => {
    const result = parseEditorMessage({ ...envelope('zap:hello', SESSION, hello), extra: 1 })
    expect(result).toEqual({ ok: true, message: envelope('zap:hello', SESSION, hello) })
  })

  it.each([null, 'zap:hello', [], { source: 'other', v: 1, session: '', type: 'zap:mode' }])(
    'ignores a non-envelope %j',
    (data) => {
      expect(parseEditorMessage(data)).toEqual({ ok: false, reason: 'not-envelope' })
    },
  )

  it('refuses another protocol version', () => {
    const message = { ...envelope('zap:mode', SESSION, 'inspect'), v: 2 }
    expect(parseEditorMessage(message)).toEqual({ ok: false, reason: 'not-envelope' })
  })

  it('drops a message over 256 KB before validating it', () => {
    const big = 'x'.repeat(MAX_MESSAGE_BYTES)
    const message = envelope('zap:values', SESSION, {
      recordRef: 'blog/x',
      locale: 'es',
      patch: { body: big },
    })
    expect(parseEditorMessage(message)).toEqual({ ok: false, reason: 'oversize' })
    // Just under the cap is fine — the cap is the boundary, not a guess.
    const small = envelope('zap:values', SESSION, {
      recordRef: 'blog/x',
      locale: 'es',
      patch: { body: 'x'.repeat(MAX_MESSAGE_BYTES - 200) },
    })
    expect(parseEditorMessage(small).ok).toBe(true)
  })

  it('counts multi-byte characters in bytes, not code units', () => {
    const message = envelope('zap:values', SESSION, {
      recordRef: 'blog/x',
      locale: 'es',
      patch: { body: 'é'.repeat(MAX_MESSAGE_BYTES / 2) },
    })
    expect(parseEditorMessage(message)).toEqual({ ok: false, reason: 'oversize' })
  })

  it('drops unknown types and page → editor types (wrong direction)', () => {
    expect(parseEditorMessage(envelope('zap:delete', SESSION, {}))).toEqual({
      ok: false,
      reason: 'unknown-type',
    })
    expect(parseEditorMessage(envelope('zap:click', SESSION, {}))).toEqual({
      ok: false,
      reason: 'unknown-type',
    })
    expect(parseEditorMessage(envelope('__proto__', SESSION, {}))).toEqual({
      ok: false,
      reason: 'unknown-type',
    })
  })

  it.each([
    ['hello with a short session', envelope('zap:hello', SESSION, { ...hello, session: 'abc' })],
    ['hello with a bad mode', envelope('zap:hello', SESSION, { ...hello, mode: 'edit' })],
    [
      'hello with a non-hex theme colour',
      envelope('zap:hello', SESSION, { ...hello, theme: { outline: 'red;background:url(x)' } }),
    ],
    ['hello with a zero zoom', envelope('zap:hello', SESSION, { ...hello, zoom: 0 })],
    [
      'values with a bad field key',
      envelope('zap:values', SESSION, { recordRef: 'blog/x', locale: 'es', patch: { 'a b': 'x' } }),
    ],
    [
      'values with an object value',
      envelope('zap:values', SESSION, {
        recordRef: 'blog/x',
        locale: 'es',
        patch: { a: { html: 'x', text: 'y' } },
      }),
    ],
    ['mode with an unknown mode', envelope('zap:mode', SESSION, 'edit')],
    [
      'highlight with 21 anchors',
      envelope('zap:highlight', SESSION, { anchors: Array(21).fill(domAnchor) }),
    ],
    [
      'highlight with a selector over 1 KB',
      envelope('zap:highlight', SESSION, {
        anchors: [{ ...domAnchor, selector: 'a'.repeat(1025) }],
      }),
    ],
    [
      'highlight with a quote over 500 chars',
      envelope('zap:highlight', SESSION, {
        anchors: [{ ...domAnchor, textQuote: { exact: 'a'.repeat(501), prefix: '', suffix: '' } }],
      }),
    ],
  ])('refuses %s', (_name, message) => {
    expect(parseEditorMessage(message)).toEqual({ ok: false, reason: 'invalid-payload' })
  })

  it('accepts the limits exactly', () => {
    const message = envelope('zap:highlight', SESSION, {
      anchors: Array(20).fill({
        ...domAnchor,
        selector: 'a'.repeat(1024),
        textQuote: { exact: 'a'.repeat(500), prefix: 'p'.repeat(32), suffix: 's'.repeat(32) },
      }),
    })
    expect(parseEditorMessage(message).ok).toBe(true)
  })
})

describe('parsePageMessage', () => {
  it('accepts every page message shape', () => {
    const anchor = { field: null, dom: domAnchor, pageUrl: 'https://ejemplo.com/blog/x' }
    const messages = [
      envelope('zap:ready', SESSION, {
        version: '0.1.0',
        capabilities: ['overlay', 'values'],
        pageUrl: 'https://ejemplo.com/',
      }),
      envelope('zap:tags', SESSION, [
        { tag: 'blog/x#title', recordRef: 'blog/x', fieldKey: 'title', count: 2 },
      ]),
      envelope('zap:click', SESSION, { recordRef: 'blog/x', fieldKey: 'title' }),
      envelope('zap:select', SESSION, { anchors: [anchor] }),
      envelope('zap:navigate', SESSION, { url: 'https://ejemplo.com/otra' }),
      envelope('zap:error', SESSION, { code: 'TAG_INVALID', detail: 'data-zap=x' }),
    ]
    for (const message of messages) expect(parsePageMessage(message).ok).toBe(true)
  })

  it('refuses a navigate to a non-http URL and a tags row whose tag disagrees', () => {
    expect(
      parsePageMessage(envelope('zap:navigate', SESSION, { url: 'javascript:alert(1)' })),
    ).toEqual({ ok: false, reason: 'invalid-payload' })
    expect(
      parsePageMessage(
        envelope('zap:tags', SESSION, [
          { tag: 'blog/y#title', recordRef: 'blog/x', fieldKey: 'title', count: 1 },
        ]),
      ),
    ).toEqual({ ok: false, reason: 'invalid-payload' })
  })

  it('drops editor → page types (wrong direction)', () => {
    expect(parsePageMessage(envelope('zap:hello', SESSION, hello))).toEqual({
      ok: false,
      reason: 'unknown-type',
    })
  })
})

describe('isPreviewValue', () => {
  it.each([
    ['x'],
    [1],
    [true],
    [null],
    [{ text: 'x' }],
    [{ html: '<p>x</p>' }],
    [{ image: {} }],
    [{ url: '/cafes' }],
    [{ email: 'hola@verdeorigen.co' }],
  ])('accepts %j', (value) => expect(isPreviewValue(value)).toBe(true))
  it.each([
    [NaN],
    [{}],
    [{ foo: 1 }],
    [[1]],
    [{ image: { src: 1 } }],
    [{ text: 1 }],
    [{ url: 1 }],
    [{ url: 'x'.repeat(2049) }],
    [{ email: 'x'.repeat(321) }],
    [{ url: '/a', text: 'b' }],
  ])('refuses %j', (value) => expect(isPreviewValue(value)).toBe(false))
})

/**
 * The draft-mode route a page announces (§2.5, §7.5): a PATH, never an origin.
 * The editor joins it to the frame's verified origin, so anything that could
 * name or imply another host must fail here, on both ends of the bridge.
 */
describe('draft-mode route in zap:ready', () => {
  const ready = (draftRoute: unknown) =>
    parsePageMessage(
      envelope('zap:ready', '', {
        version: '0.10.0',
        capabilities: ['overlay', 'values', 'stega'],
        pageUrl: 'https://ejemplo.com/',
        draftRoute,
      }),
    )

  it.each(['/api/zap-preview', '/es/api/zap-preview', '/api/preview_v2', '/a:b/c@d', '/'])(
    'accepts the path %s',
    (path) => {
      expect(isDraftRoutePath(path)).toBe(true)
      expect(ready(path).ok).toBe(true)
    },
  )

  it('accepts null and an absent route (older clients)', () => {
    expect(ready(null).ok).toBe(true)
    expect(ready(undefined).ok).toBe(true)
  })

  it.each([
    'https://evil.example/api/zap-preview',
    '//evil.example/api/zap-preview',
    '/\\evil.example',
    '\\\\evil.example',
    'evil.example/api',
    'api/zap-preview',
    '/api//zap-preview',
    '/./evil',
    '/a/../evil',
    '/%2e%2e/evil',
    '/api/zap-preview?token=x',
    '/api/zap-preview#x',
    '/api zap',
    '/api\tzap',
    `/${'a'.repeat(600)}`,
    'javascript:alert(1)',
    '',
    42,
    {},
  ])('refuses %s, and the whole ready with it', (value) => {
    expect(isDraftRoutePath(value)).toBe(false)
    expect(ready(value)).toEqual({ ok: false, reason: 'invalid-payload' })
  })

  it('a tag summary may name its source, and nothing else', () => {
    const tags = (source: unknown) =>
      parsePageMessage(
        envelope('zap:tags', SESSION, [
          { tag: 'blog/x#title', recordRef: 'blog/x', fieldKey: 'title', count: 1, source },
        ]),
      ).ok
    expect([tags('stega'), tags('attr'), tags(undefined)]).toEqual([true, true, true])
    expect(tags('script')).toBe(false)
  })
})

/**
 * Comments (§3.3 spot anchors): `zap:pins` editor → page, `zap:spot` and
 * `zap:pin` page → editor, mode `spot`, capability `pins`. Every field is
 * checked; one bad pin fails the whole message.
 */
describe('comment pins and spots', () => {
  const spotPin = { id: 'c_1-a', n: 1, spot: { x: 0.4, y: 0.2 } }
  const domPin = { id: 'C2', n: 999, dom: domAnchor }
  const pins = (list: unknown) => parseEditorMessage(envelope('zap:pins', SESSION, { pins: list }))
  const spot = (payload: unknown) => parsePageMessage(envelope('zap:spot', SESSION, payload))
  const validSpot = {
    spot: { x: 0, y: 1 },
    viewport: { w: 1280, h: 2200 },
    pageUrl: 'https://ejemplo.com/blog/x',
  }

  it('accepts spot and dom pins, the limits exactly, and an empty list', () => {
    expect(pins([spotPin, domPin]).ok).toBe(true)
    expect(pins([]).ok).toBe(true)
    expect(pins(Array(50).fill({ ...spotPin, id: 'a'.repeat(64) })).ok).toBe(true)
    expect(pins([{ ...spotPin, spot: { x: 0, y: 1 } }]).ok).toBe(true)
  })

  it.each([
    ['51 pins', Array(51).fill(spotPin)],
    ['both spot and dom', [{ ...spotPin, dom: domAnchor }]],
    ['neither spot nor dom', [{ id: 'a', n: 1 }]],
    ['n = 0', [{ ...spotPin, n: 0 }]],
    ['n = 1000', [{ ...spotPin, n: 1000 }]],
    ['a fractional n', [{ ...spotPin, n: 1.5 }]],
    ['n as a string', [{ ...spotPin, n: '1' }]],
    ['an empty id', [{ ...spotPin, id: '' }]],
    ['a 65-char id', [{ ...spotPin, id: 'a'.repeat(65) }]],
    ['an id with markup', [{ ...spotPin, id: '<b>x</b>' }]],
    ['an id with a space', [{ ...spotPin, id: 'a b' }]],
    ['x over 1', [{ ...spotPin, spot: { x: 1.01, y: 0 } }]],
    ['y under 0', [{ ...spotPin, spot: { x: 0, y: -0.01 } }]],
    ['a NaN coordinate', [{ ...spotPin, spot: { x: NaN, y: 0 } }]],
    ['an invalid dom anchor', [{ ...domPin, dom: { ...domAnchor, selector: 'a'.repeat(1025) } }]],
    ['one bad pin among good ones', [spotPin, domPin, { ...spotPin, n: -1 }]],
    ['pins not a list', { 0: spotPin }],
  ])('zap:pins refuses %s', (_name, list) => {
    expect(pins(list)).toEqual({ ok: false, reason: 'invalid-payload' })
  })

  it('mode spot is a mode, in zap:mode and in the hello', () => {
    expect(parseEditorMessage(envelope('zap:mode', SESSION, 'spot')).ok).toBe(true)
    expect(parseEditorMessage(envelope('zap:hello', SESSION, { ...hello, mode: 'spot' })).ok).toBe(
      true,
    )
  })

  it('zap:spot accepts a point of the document, the bounds exactly', () => {
    expect(spot(validSpot).ok).toBe(true)
    expect(spot({ ...validSpot, viewport: { w: 1, h: 1 } }).ok).toBe(true)
    expect(spot({ ...validSpot, viewport: { w: 100_000, h: 10_000_000 } }).ok).toBe(true)
  })

  it.each([
    ['x over 1', { ...validSpot, spot: { x: 1.5, y: 0 } }],
    ['y under 0', { ...validSpot, spot: { x: 0, y: -1 } }],
    ['a missing spot', { viewport: validSpot.viewport, pageUrl: validSpot.pageUrl }],
    ['a zero-wide viewport', { ...validSpot, viewport: { w: 0, h: 2200 } }],
    ['a viewport too wide', { ...validSpot, viewport: { w: 100_001, h: 2200 } }],
    ['a viewport too tall', { ...validSpot, viewport: { w: 1280, h: 10_000_001 } }],
    ['an infinite height', { ...validSpot, viewport: { w: 1280, h: Infinity } }],
    ['a missing viewport', { spot: validSpot.spot, pageUrl: validSpot.pageUrl }],
    ['a javascript: page URL', { ...validSpot, pageUrl: 'javascript:alert(1)' }],
    ['no page URL', { spot: validSpot.spot, viewport: validSpot.viewport }],
  ])('zap:spot refuses %s', (_name, payload) => {
    expect(spot(payload)).toEqual({ ok: false, reason: 'invalid-payload' })
  })

  it('zap:pin carries an id of the pin grammar, nothing else', () => {
    const pin = (id: unknown) => parsePageMessage(envelope('zap:pin', SESSION, { id })).ok
    expect(pin('c_1-a')).toBe(true)
    expect([pin(''), pin('a'.repeat(65)), pin('a/b'), pin(1), pin(undefined)]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('each new type is known in its direction only', () => {
    expect(parsePageMessage(envelope('zap:pins', SESSION, { pins: [] }))).toEqual({
      ok: false,
      reason: 'unknown-type',
    })
    expect(parseEditorMessage(envelope('zap:spot', SESSION, validSpot))).toEqual({
      ok: false,
      reason: 'unknown-type',
    })
    expect(parseEditorMessage(envelope('zap:pin', SESSION, { id: 'a' }))).toEqual({
      ok: false,
      reason: 'unknown-type',
    })
  })

  it('a ready may advertise pins; an unknown capability still fails it', () => {
    const ready = (capabilities: unknown) =>
      parsePageMessage(
        envelope('zap:ready', '', { version: '0.11.0', capabilities, pageUrl: 'https://e.co/' }),
      ).ok
    expect(ready(['overlay', 'values', 'stega', 'pins'])).toBe(true)
    expect(ready(['overlay', 'values', 'stega', 'pins', 'links'])).toBe(true)
    expect(ready(['overlay', 'values', 'stega', 'pins', 'links', 'refresh'])).toBe(true)
    expect(ready(['overlay', 'comments'])).toBe(false)
  })
})

describe('foreign labels in the hello', () => {
  const FOREIGN = { 'doc:configuracion#boletin_titulo': ['Título', 'en Configuración'] }
  const parse = (foreign: unknown) =>
    parseEditorMessage(envelope('zap:hello', SESSION, { ...hello, foreign })).ok

  it('accepts a hello with foreign labels, and one without', () => {
    expect(parse(FOREIGN)).toBe(true)
    expect(parseEditorMessage(envelope('zap:hello', SESSION, hello)).ok).toBe(true)
    expect(parse({})).toBe(true)
  })

  it('accepts the limits exactly', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_LABELS }, (_, i) => [
        `blog/x#f${i}`,
        ['a'.repeat(200), 'b'.repeat(200)],
      ]),
    )
    expect(parse(many)).toBe(true)
  })

  it.each([
    ['a key that is a field key, not a tag', { boletin_titulo: ['Título', 'en Configuración'] }],
    ['a key with a bad record', { 'Doc:x#title': ['Título', 'en X'] }],
    ['a bare string', { 'doc:configuracion#boletin_titulo': 'Título' }],
    ['one string', { 'doc:configuracion#boletin_titulo': ['Título'] }],
    ['three strings', { 'doc:configuracion#boletin_titulo': ['Título', 'en X', 'y'] }],
    ['a non-string part', { 'doc:configuracion#boletin_titulo': ['Título', 1] }],
    ['a label over 200 chars', { 'doc:configuracion#boletin_titulo': ['a'.repeat(201), 'en X'] }],
    [
      'a suffix over 200 chars',
      { 'doc:configuracion#boletin_titulo': ['Título', 'a'.repeat(201)] },
    ],
    [
      `more than ${MAX_LABELS} entries`,
      Object.fromEntries(
        Array.from({ length: MAX_LABELS + 1 }, (_, i) => [`blog/x#f${i}`, ['a', 'b']]),
      ),
    ],
    ['an array', [['doc:configuracion#boletin_titulo', ['Título', 'en X']]]],
  ])('refuses the whole hello for %s', (_name, foreign) => {
    expect(parseEditorMessage(envelope('zap:hello', SESSION, { ...hello, foreign }))).toEqual({
      ok: false,
      reason: 'invalid-payload',
    })
  })
})

describe('zap:click rect and zap:refresh', () => {
  const click = (extra: Record<string, unknown> = {}) =>
    parsePageMessage(
      envelope('zap:click', SESSION, { recordRef: 'blog/x', fieldKey: 'title', ...extra }),
    ).ok

  it('a click may carry the element box, or not (older clients)', () => {
    expect(click()).toBe(true)
    expect(click({ rect: { x: 12, y: 340, w: 300, h: 40 } })).toBe(true)
    // Partly scrolled out of view: x and y may be negative; an empty box is a box.
    expect(click({ rect: { x: -20, y: -300, w: 0, h: 0 } })).toBe(true)
  })

  it.each([
    ['a negative width', { x: 0, y: 0, w: -1, h: 10 }],
    ['a negative height', { x: 0, y: 0, w: 10, h: -1 }],
    ['an infinite x', { x: Infinity, y: 0, w: 10, h: 10 }],
    ['a NaN y', { x: 0, y: NaN, w: 10, h: 10 }],
    ['a string width', { x: 0, y: 0, w: '10', h: 10 }],
    ['a missing height', { x: 0, y: 0, w: 10 }],
    ['a non-object', 'x'],
    ['null', null],
  ])('refuses a click rect with %s', (_name, rect) => {
    expect(click({ rect })).toBe(false)
  })

  it('zap:refresh is an editor message with an empty object', () => {
    expect(parseEditorMessage(envelope('zap:refresh', SESSION, {}))).toEqual({
      ok: true,
      message: envelope('zap:refresh', SESSION, {}),
    })
    for (const payload of [null, 'reload', 1, undefined]) {
      expect(parseEditorMessage(envelope('zap:refresh', SESSION, payload))).toEqual({
        ok: false,
        reason: 'invalid-payload',
      })
    }
    // Wrong direction.
    expect(parsePageMessage(envelope('zap:refresh', SESSION, {}))).toEqual({
      ok: false,
      reason: 'unknown-type',
    })
  })
})
