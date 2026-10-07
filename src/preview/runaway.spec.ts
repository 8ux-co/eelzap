import { afterEach, describe, expect, it, vi } from 'vitest'

import { splitStega, stegaDecode, stegaEncode, stegaMarker } from '../stega'
import { envelope, MAX_QUOTE_CONTEXT, parsePageMessage } from './protocol'
import { startRuntime, type PageRuntime } from './runtime'
import { MAX_TAGGED, observeTags, RUNAWAY_PASSES, TagIndex, tagGuard } from './tags'
import { ValueApplier } from './values'

/**
 * The P0 editor crash (2026-10): a draft's values carried stega markers, and
 * `reapply()` kept the node's markers and appended the value's on every pass.
 * Each new marker was one more tagged entry at the next scan, so the tagged
 * count doubled (1,582 → 3,118 → 6,190) until the renderer ran out of memory.
 *
 * - Stability: values with markers (whole, and cut by the 32-character quote
 *   context) settle after one pass and never grow the index or the node.
 * - The runaway guard (`tagGuard`, `zap:paused`): growth that nothing on the
 *   page explains, three passes in a row, or more than 5,000 tagged elements,
 *   stops the runtime for good and tells the editor.
 */

const ZAP = 'https://zap.eel.software'
const SESSION = '0123456789abcdef0123456789abcdef'
const REF = 'blog/hola'

const runtimes: PageRuntime[] = []
afterEach(() => {
  while (runtimes.length) runtimes.pop()!.destroy()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function boot(html: string, throttleMs = 0) {
  document.body.innerHTML = html
  const parent = { postMessage: vi.fn() }
  const runtime = startRuntime(
    { editorOrigins: [ZAP], pageUrl: () => 'https://ejemplo.com/blog/hola', lazyOverlay: true },
    { win: window, doc: document, parent, throttleMs },
  )
  runtimes.push(runtime)
  const deliver = (type: string, payload: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: envelope(type, SESSION, payload),
        origin: ZAP,
        source: parent as unknown as MessageEventSource,
      }),
    )
  const posted = () =>
    parent.postMessage.mock.calls.map(
      ([message]) => message as { type: string; payload: unknown; session: string },
    )
  const paused = () => posted().filter((m) => m.type === 'zap:paused')
  const hello = () =>
    deliver('zap:hello', {
      session: SESSION,
      siteKey: 'main',
      locale: 'es',
      labels: { title: 'Título' },
      recordRef: REF,
      mode: 'inspect',
    })
  return { runtime, deliver, posted, paused, hello }
}

const mark = (text: string, fieldKey: string) => stegaEncode(text, { recordRef: REF, fieldKey })

describe('reapply with marked values stays stable (the P0 crash)', () => {
  it('whole and quote-cut markers: ≥ 5 passes, same tagged count, one marker per node', () => {
    const { runtime, deliver, hello, paused } = boot(`
      <h1>${mark('Hola', 'title')}</h1>
      <p id="sub">${mark('Subtítulo', 'subtitle')}</p>
      <p id="lead">${mark('Entrada', 'lead')}</p>
    `)
    hello()
    const before = runtime.index.elements.length
    expect(before).toBe(3)

    // A value copied from the preview into the form, with its marker whole.
    const whole = mark('Título nuevo', 'title')
    // The anchor's quote context keeps 32 characters (`textQuoteFor`): the
    // suffix cut keeps a marker's head, the prefix cut a marker's tail.
    const head = `Otro ${mark('', 'subtitle')}`.slice(0, MAX_QUOTE_CONTEXT)
    const tail = `Más ${mark('', 'lead')}`.slice(-MAX_QUOTE_CONTEXT)
    expect(head.length).toBe(MAX_QUOTE_CONTEXT)
    expect(stegaDecode(head)).toEqual([])
    deliver('zap:values', {
      recordRef: REF,
      locale: 'es',
      patch: { title: whole, subtitle: head, lead: tail },
    })

    const nodes = () =>
      ['h1', '#sub', '#lead'].map(
        (selector) => document.querySelector(selector)!.firstChild as Text,
      )
    const own = {
      title: stegaMarker({ recordRef: REF, fieldKey: 'title' }),
      subtitle: stegaMarker({ recordRef: REF, fieldKey: 'subtitle' }),
      lead: stegaMarker({ recordRef: REF, fieldKey: 'lead' }),
    }
    let first: string[] | null = null
    for (let pass = 0; pass < 6; pass++) {
      runtime.refresh()
      expect(runtime.index.elements.length, `pass ${pass}`).toBe(before)
      const [h1, sub, lead] = nodes()
      // Each node keeps exactly its own marker, once.
      expect(splitStega(h1!.data).markers).toBe(own.title)
      expect(splitStega(sub!.data).markers).toBe(own.subtitle)
      expect(splitStega(lead!.data).markers).toBe(own.lead)
      for (const node of nodes()) expect(stegaDecode(node.data)).toHaveLength(1)
      expect(splitStega(h1!.data).text).toBe('Título nuevo')
      // Settled: the node text does not change from one pass to the next.
      const data = nodes().map((node) => node.data)
      if (first) expect(data).toEqual(first)
      else first = data
    }
    expect(paused()).toEqual([])
  })

  it('ValueApplier alone: a marked value never adds a marker, pass after pass', () => {
    document.body.innerHTML = `<h1>${mark('Hola', 'title')}</h1>`
    const index = new TagIndex(document)
    index.scan()
    const values = new ValueApplier(index, document)
    values.apply({ recordRef: REF, locale: 'es', patch: { title: mark('Nuevo', 'title') } })
    for (let pass = 0; pass < 5; pass++) {
      index.scan()
      values.reapply()
      expect(index.elements).toHaveLength(1)
      expect(stegaDecode(document.querySelector('h1')!.textContent ?? '')).toHaveLength(1)
    }
  })
})

describe('tagGuard', () => {
  it('trips on the third unexplained growth in a row, not before', () => {
    const check = tagGuard()
    expect(check(10, true)).toBeNull()
    expect(check(20, false)).toBeNull()
    expect(check(40, false)).toBeNull()
    expect(check(80, false)).toBe('runaway')
    expect(RUNAWAY_PASSES).toBe(3)
  })

  it('a page mutation, a steady pass or a shrink resets the streak', () => {
    const check = tagGuard()
    check(1, true)
    expect(check(2, false)).toBeNull()
    expect(check(3, false)).toBeNull()
    expect(check(4, true)).toBeNull() // the page explains this one
    expect(check(5, false)).toBeNull()
    expect(check(6, false)).toBeNull()
    expect(check(6, false)).toBeNull() // steady
    expect(check(7, false)).toBeNull()
    expect(check(8, false)).toBeNull()
    expect(check(9, false)).toBe('runaway')
  })

  it('trips past the cap, explained or not', () => {
    expect(MAX_TAGGED).toBe(5000)
    expect(tagGuard()(5000, true)).toBeNull()
    expect(tagGuard()(5001, true)).toBe('cap')
  })
})

describe('observeTags: the page flag', () => {
  it('own writes made during onChange still lead to a call, with page false', async () => {
    document.body.innerHTML = '<main><h1>Hola</h1></main>'
    const timers: Array<() => void> = []
    const calls: boolean[] = []
    let writes = 1
    const stop = observeTags(
      document.body,
      (page) => {
        calls.push(page)
        if (writes-- > 0) document.querySelector('h1')!.textContent = 'Escrito por nosotros'
      },
      { setTimeout: (fn) => timers.push(fn), clearTimeout: () => {} },
    )
    document.querySelector('main')!.append(document.createElement('p'))
    await Promise.resolve()
    timers.shift()!()
    expect(calls).toEqual([true])
    // The write above was taken back from the observer and queued as ours.
    expect(timers).toHaveLength(1)
    timers.shift()!()
    expect(calls).toEqual([true, false])
    await Promise.resolve()
    expect(timers).toHaveLength(0)
    stop()
  })
})

describe('runaway guard in the page runtime', () => {
  it('growth fed by our own passes: pauses, posts zap:paused, disconnects, writes nothing more', async () => {
    vi.useFakeTimers()
    const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect')
    const reapply = vi.spyOn(ValueApplier.prototype, 'reapply')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { runtime, hello, deliver, paused } = boot(
      `<main><h1 data-zap="${REF}#title">Hola</h1></main>`,
    )
    hello()
    // The overlay's host joined the page: let that pass run first.
    await vi.advanceTimersByTimeAsync(50)

    // An uncleaned path: every pass adds one more tagged element of its own.
    const main = document.querySelector('main')!
    const scan = runtime.index.scan.bind(runtime.index)
    const scans = vi.spyOn(runtime.index, 'scan').mockImplementation(() => {
      const span = document.createElement('span')
      span.setAttribute('data-zap', `${REF}#title`)
      main.append(span)
      scan()
    })
    // One page mutation starts it (explained), then the passes feed themselves.
    main.append(document.createElement('i'))
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(20)

    expect(paused()).toHaveLength(1)
    expect(paused()[0]).toMatchObject({
      session: SESSION,
      payload: { reason: 'runaway', count: 5 },
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalled()

    // Nothing more: no scan, no reapply, no values written, no second pause.
    const scanned = scans.mock.calls.length
    const reapplied = reapply.mock.calls.length
    main.append(document.createElement('b'))
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(20)
    runtime.refresh()
    deliver('zap:values', { recordRef: REF, locale: 'es', patch: { title: 'Nuevo' } })
    expect(scans.mock.calls.length).toBe(scanned)
    expect(reapply.mock.calls.length).toBe(reapplied)
    expect(document.querySelector('h1')!.textContent).toBe('Hola')
    expect(paused()).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a site that keeps rendering (every pass explained by the page) is not paused', async () => {
    vi.useFakeTimers()
    const { hello, paused } = boot(`<main><h1 data-zap="${REF}#title">Hola</h1></main>`)
    hello()
    const main = document.querySelector('main')!
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('p')
      p.setAttribute('data-zap', `${REF}#title`)
      main.append(p)
      await vi.advanceTimersByTimeAsync(20)
    }
    expect(paused()).toEqual([])
  })

  it('more than 5,000 tagged elements at boot: paused at once, told again after the hello', () => {
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spans = Array.from(
      { length: MAX_TAGGED + 1 },
      (_, i) => `<span data-zap="${REF}#f${i}">x</span>`,
    ).join('')
    const { runtime, hello, deliver, paused } = boot(`<main>${spans}</main>`)
    // Posted before the hello too, with no session (the editor drops it).
    expect(paused()).toEqual([
      expect.objectContaining({ session: '', payload: { reason: 'cap', count: MAX_TAGGED + 1 } }),
    ])
    expect(observe).not.toHaveBeenCalled()
    hello()
    expect(paused().at(-1)).toMatchObject({
      session: SESSION,
      payload: { reason: 'cap', count: MAX_TAGGED + 1 },
    })
    deliver('zap:values', { recordRef: REF, locale: 'es', patch: { f0: 'Nuevo' } })
    expect(document.querySelector('span')!.textContent).toBe('x')
    const scans = vi.spyOn(runtime.index, 'scan')
    runtime.refresh()
    expect(scans).not.toHaveBeenCalled()
  })

  it('crossing the cap later, even by the page itself, pauses', async () => {
    vi.useFakeTimers()
    const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spans = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => `<span data-zap="${REF}#f${from + i}">x</span>`).join('')
    const { hello, paused } = boot(`<main>${spans(0, MAX_TAGGED - 10)}</main>`)
    hello()
    await vi.advanceTimersByTimeAsync(50)
    expect(paused()).toEqual([])
    document.querySelector('main')!.insertAdjacentHTML('beforeend', spans(MAX_TAGGED, 20))
    await vi.advanceTimersByTimeAsync(50)
    expect(paused()).toEqual([
      expect.objectContaining({
        session: SESSION,
        payload: { reason: 'cap', count: MAX_TAGGED + 10 },
      }),
    ])
    expect(disconnect).toHaveBeenCalled()
  })
})

describe('zap:paused on the wire', () => {
  const parse = (payload: unknown) => parsePageMessage(envelope('zap:paused', SESSION, payload)).ok

  it('the editor accepts a reason it knows and a whole count', () => {
    expect(parse({ reason: 'runaway', count: 6190 })).toBe(true)
    expect(parse({ reason: 'cap', count: 5001 })).toBe(true)
  })

  it('and drops anything else', () => {
    expect(parse({ reason: 'oom', count: 1 })).toBe(false)
    expect(parse({ reason: 'cap', count: -1 })).toBe(false)
    expect(parse({ reason: 'cap', count: 1.5 })).toBe(false)
    expect(parse({ reason: 'cap', count: '5001' })).toBe(false)
    expect(parse({ reason: 'cap' })).toBe(false)
    expect(parse(null)).toBe(false)
  })
})
