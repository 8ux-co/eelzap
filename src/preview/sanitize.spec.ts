import { describe, expect, it } from 'vitest'

import { isSafeSrcset, richTextToText, sanitizeRichTextToString } from './sanitize'

const clean = (html: string) => sanitizeRichTextToString(html, document)

describe('sanitizeRichText — what survives', () => {
  it('keeps the markup Zap’s rich-text editor emits', () => {
    const html =
      '<h2>Título</h2><p style="text-align: center">Hola <strong>mundo</strong> <em>y</em> <u>más</u> <s>no</s></p>' +
      '<ul><li>uno</li></ul><ol><li>dos</li></ol><blockquote>cita</blockquote><pre><code>x</code></pre><hr>' +
      '<p><a href="https://ejemplo.com/a" target="_blank">enlace</a> <a href="/relativo">rel</a> <a href="mailto:a@b.co">m</a></p>' +
      '<img src="https://cdn.example/x.jpg" alt="Foto" data-media-id="0b5e-12" width="640" height="480">'
    expect(clean(html)).toBe(
      '<h2>Título</h2><p style="text-align: center">Hola <strong>mundo</strong> <em>y</em> <u>más</u> <s>no</s></p>' +
        '<ul><li>uno</li></ul><ol><li>dos</li></ol><blockquote>cita</blockquote><pre><code>x</code></pre><hr>' +
        '<p><a href="https://ejemplo.com/a" target="_blank" rel="noopener noreferrer">enlace</a> <a href="/relativo">rel</a> <a href="mailto:a@b.co">m</a></p>' +
        '<img src="https://cdn.example/x.jpg" alt="Foto" data-media-id="0b5e-12" width="640" height="480">',
    )
  })
})

describe('sanitizeRichText — what is removed', () => {
  it.each([
    ['<p>a<script>alert(1)</script>b</p>', '<p>ab</p>'],
    ['<p>a<style>p{display:none}</style>b</p>', '<p>ab</p>'],
    ['<iframe src="https://evil.example"></iframe><p>x</p>', '<p>x</p>'],
    ['<svg><script>alert(1)</script></svg><p>x</p>', '<p>x</p>'],
    ['<math><mi>x</mi></math>', ''],
    ['<form action="https://evil.example"><input name="a"></form>', ''],
    ['<object data="x"></object><embed src="x">', ''],
    ['<template><img src=x onerror=alert(1)></template>', ''],
    ['<!-- hidden --><p>x</p>', '<p>x</p>'],
    ['<base href="https://evil.example/"><p>x</p>', '<p>x</p>'],
    ['<meta http-equiv="refresh" content="0;url=https://evil.example"><p>x</p>', '<p>x</p>'],
  ])('drops %j with its content', (html, expected) => {
    expect(clean(html)).toBe(expected)
  })

  it.each([
    ['<p onclick="alert(1)">x</p>', '<p>x</p>'],
    [
      '<img src="https://cdn.example/x.jpg" onerror="alert(1)">',
      '<img src="https://cdn.example/x.jpg">',
    ],
    [
      '<a href="https://ejemplo.com" onmouseover="alert(1)">x</a>',
      '<a href="https://ejemplo.com">x</a>',
    ],
    ['<p class="evil" id="x" data-foo="1">x</p>', '<p>x</p>'],
    ['<p style="background:url(https://evil.example/beacon)">x</p>', '<p>x</p>'],
    ['<p style="text-align:left; position:fixed">x</p>', '<p>x</p>'],
    ['<a href="https://ejemplo.com" target="_top">x</a>', '<a href="https://ejemplo.com">x</a>'],
    ['<a href="https://ejemplo.com" rel="opener">x</a>', '<a href="https://ejemplo.com">x</a>'],
  ])('strips dangerous attributes from %j', (html, expected) => {
    expect(clean(html)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    ' \njavascript:alert(1)',
    '&#106;avascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
  ])('removes a script-bearing href %j', (href) => {
    const out = clean(`<a href="${href.replace(/"/g, '&quot;')}">x</a>`)
    expect(out).toBe('<a>x</a>')
  })

  it('drops an image whose src is not http(s) instead of leaving it broken', () => {
    expect(clean('<img src="data:image/svg+xml,<svg onload=alert(1)>">')).toBe('')
    expect(clean('<img src="javascript:alert(1)">')).toBe('')
    expect(clean('<img alt="no src">')).toBe('')
  })

  it('unwraps unknown formatting but keeps the text', () => {
    expect(clean('<div><section><font color="red">hola</font></section></div>')).toBe('hola')
  })

  it('cannot be escaped by mutation-XSS nesting', () => {
    // The fragment's NODES are inserted (never re-serialised and re-parsed),
    // so whatever the parser made of this, no handler attribute survives.
    const out = clean('<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>')
    expect(out).not.toMatch(/onerror|alert/)
  })
})

describe('richTextToText', () => {
  it('returns the text without the text of dropped elements', () => {
    expect(richTextToText('<p>Hola <b>mundo</b><script>steal()</script></p>', document)).toBe(
      'Hola mundo',
    )
  })
})

describe('isSafeSrcset', () => {
  it('needs every candidate to be http(s)', () => {
    expect(isSafeSrcset('https://a/1.jpg 1x, https://a/2.jpg 2x')).toBe(true)
    expect(isSafeSrcset('https://a/1.jpg 1x, javascript:alert(1) 2x')).toBe(false)
    expect(isSafeSrcset('')).toBe(false)
  })
})
