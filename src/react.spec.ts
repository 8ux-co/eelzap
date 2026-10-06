import { act, render, renderHook } from '@testing-library/react'
import { createElement, StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { __resetLiveForTests, initZap, ZAP_PRODUCTION_ORIGIN } from './preview/live'
import { envelope } from './preview/protocol'
import { mergeLiveValues, onValues, toFieldValue, useZapLiveUpdates, ZapPreview } from './react'

const SESSION = '0123456789abcdef0123456789abcdef'

const POST = {
  slug: 'hola',
  localizedSlugs: { en: 'hello' },
  collection: { key: 'blog', name: 'Blog' },
  content: {
    title: 'Publicado',
    cover: { url: 'https://cdn.example/a.jpg', alt: 'A', width: 800 },
    views: 3,
  },
}

function framedClient(siteKey = 'verdeorigen') {
  const parent = { postMessage: vi.fn() }
  initZap({ siteKey }, { win: window, doc: document, parent, throttleMs: 0 })
  const deliver = (type: string, payload: unknown) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: envelope(type, SESSION, payload),
          origin: ZAP_PRODUCTION_ORIGIN,
          source: parent as unknown as MessageEventSource,
        }),
      )
    })
  deliver('zap:hello', {
    session: SESSION,
    siteKey: 'verdeorigen',
    locale: 'es',
    labels: {},
    recordRef: 'blog/hola',
    mode: 'off',
  })
  return deliver
}

afterEach(() => {
  __resetLiveForTests()
  document.body.innerHTML = ''
})

describe('useZapLiveUpdates', () => {
  it('returns the same entry object until the editor sends values', () => {
    framedClient()
    const { result } = renderHook(() => useZapLiveUpdates(POST))
    expect(result.current).toBe(POST)
  })

  it('merges each patch into content, accumulating, and leaves the input untouched', () => {
    const deliver = framedClient()
    const { result } = renderHook(() => useZapLiveUpdates(POST))
    deliver('zap:values', { recordRef: 'blog/hola', locale: 'es', patch: { title: 'Borrador' } })
    deliver('zap:values', {
      recordRef: 'blog/hola',
      locale: 'es',
      patch: { cover: { image: { src: 'https://cdn.example/b.jpg', alt: 'B' } } },
    })
    expect(result.current.content).toEqual({
      title: 'Borrador',
      cover: { url: 'https://cdn.example/b.jpg', alt: 'B', width: 800 },
      views: 3,
    })
    expect(result.current.slug).toBe('hola')
    expect(POST.content.title).toBe('Publicado')
  })

  it('answers to a localized slug, and ignores another record', () => {
    const deliver = framedClient()
    const { result } = renderHook(() => useZapLiveUpdates(POST))
    deliver('zap:values', { recordRef: 'blog/otro', locale: 'es', patch: { title: 'Otro' } })
    expect(result.current).toBe(POST)
    deliver('zap:values', { recordRef: 'blog/hello', locale: 'en', patch: { title: 'Draft' } })
    expect(result.current.content.title).toBe('Draft')
  })

  it('drops the patch when the hook is handed another entry', () => {
    const deliver = framedClient()
    const { result, rerender } = renderHook(({ entry }) => useZapLiveUpdates(entry), {
      initialProps: {
        entry: POST as Omit<typeof POST, 'localizedSlugs'> & {
          localizedSlugs: Record<string, string>
        },
      },
    })
    deliver('zap:values', { recordRef: 'blog/hola', locale: 'es', patch: { title: 'Borrador' } })
    const next = { ...POST, slug: 'otro', localizedSlugs: {} }
    rerender({ entry: next })
    expect(result.current).toBe(next)
  })

  it('never changes anything outside Zap (no client started)', () => {
    const { result } = renderHook(() => useZapLiveUpdates(POST))
    expect(result.current).toBe(POST)
  })
})

describe('mergeLiveValues and toFieldValue', () => {
  it('merges into the object itself when it has no content', () => {
    expect(mergeLiveValues({ title: 'a', n: 1 }, { title: { text: 'b' } })).toEqual({
      title: 'b',
      n: 1,
    })
  })

  it('maps each display value to a plain one', () => {
    expect(toFieldValue({ html: '<p>x</p>' }, null)).toBe('<p>x</p>')
    expect(toFieldValue({ url: '/cafes' }, '/old')).toBe('/cafes')
    expect(toFieldValue({ email: 'a@b.co' }, null)).toBe('a@b.co')
    expect(toFieldValue(null, 'x')).toBeNull()
    expect(toFieldValue(4, 3)).toBe(4)
    expect(toFieldValue({ image: { src: 'https://a/b.png' } }, 'old')).toEqual({
      url: 'https://a/b.png',
    })
  })
})

/**
 * `./react` never bundles the overlay (zap-cms-v2 §2.7): `onValues` and the
 * hook hear the overlay's `eelzap:values` window event, and `ZapPreview`
 * only runs the boot.
 */
describe('onValues and ZapPreview (no overlay in the bundle)', () => {
  const emit = (detail: unknown) =>
    window.dispatchEvent(new CustomEvent('eelzap:values', { detail }))

  it('onValues hears patches for its entry only, until unsubscribed', () => {
    const handler = vi.fn()
    const stop = onValues(POST, handler)
    emit({ recordRef: 'blog/hello', locale: 'en', patch: { title: 'Hi' } })
    emit({ recordRef: 'blog/otro', locale: 'es', patch: { title: 'No' } })
    emit({ recordRef: 'blog/hola', patch: 'not an object' })
    emit(null)
    stop()
    emit({ recordRef: 'blog/hola', locale: 'es', patch: { title: 'Tarde' } })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]![0]).toEqual({ title: 'Hi' })
  })

  it('a handler that throws does not stop the others', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const second = vi.fn()
    const stops = [
      onValues('blog/hola', () => {
        throw new Error('boom')
      }),
      onValues('blog/hola', second),
    ]
    emit({ recordRef: 'blog/hola', locale: 'es', patch: { title: 'x' } })
    stops.forEach((stop) => stop())
    expect(second).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled()
  })

  it('ZapPreview renders nothing, and outside a preview session adds nothing to the page', () => {
    const { container, unmount } = render(createElement(ZapPreview, { siteKey: 'verdeorigen' }))
    expect(container.innerHTML).toBe('')
    expect(document.head.querySelector('script')).toBeNull()
    unmount()
  })

  it('ZapPreview under StrictMode, and remounted, adds ONE overlay script', () => {
    const props = { siteKey: 'verdeorigen', preview: true }
    const first = render(createElement(StrictMode, null, createElement(ZapPreview, props)))
    first.unmount()
    const second = render(createElement(StrictMode, null, createElement(ZapPreview, props)))
    const scripts = document.head.querySelectorAll('script[src*="/js/preview/preview.v1."]')
    expect(scripts).toHaveLength(1)
    second.unmount()
    scripts.forEach((script) => script.remove())
  })
})
