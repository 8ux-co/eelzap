import { buildAnchor, findAnchorElement } from './anchor'
import { Overlay } from './overlay'
import { createPageBridge, type MessageTargetLike, type PageBridge } from './page-bridge'
import {
  CAPABILITIES,
  PAGE_UNLOAD_ERROR,
  type DiffMark,
  type EditorMessage,
  type PausedPayload,
  type TagSummary,
} from './protocol'
import { createScrollSync } from './scroll'
import { observeTags, TagIndex, tagGuard, type TagProblem } from './tags'
import { ValueApplier } from './values'

/**
 * The page runtime: index, overlay, values and bridge, wired together. The
 * Live client (`live.ts`) boots it inside the customer's own page, framed by
 * Zap's editor by its real URL (§2.7).
 */

export const CLIENT_VERSION = '0.11.0'

export interface RuntimeOptions {
  win?: Window
  doc?: Document
  parent?: MessageTargetLike
  /** Rescan throttle. Default 250 ms. */
  throttleMs?: number
}

export interface PageRuntime {
  readonly bridge: PageBridge
  readonly index: TagIndex
  readonly overlay: Overlay
  /** Force a rescan + report now (specs, and after a navigation); nothing once paused. */
  refresh(): void
  destroy(): void
}

const MAX_PROBLEM_REPORTS = 20

/**
 * What one runtime needs beyond the DOM: who it talks to and how the page
 * behaves. The Live client builds it from the origins it trusts (`live.ts`).
 */
export interface RuntimeConfig {
  editorOrigins: readonly string[]
  /** Where `zap:ready` goes before the hello names the editor. */
  preHelloTargets?(): readonly string[]
  /** The site's draft-mode route path, announced in `zap:ready`. */
  draftRoute?: string | null
  /** The page's real URL (`location.href`; it moves on client-side routing). */
  pageUrl(): string
  /**
   * Nothing is added to the page (no overlay element, no listeners) until
   * a verified `zap:hello`, so a page framed by anyone else stays untouched (§7.3 "Overlay as an attack surface on public pages").
   */
  lazyOverlay?: boolean
  /**
   * A last say on a message the bridge accepted (the hello must name this
   * site). False ignores it, before the runtime touches the page.
   */
  accept?(message: EditorMessage): boolean
  /** Called after the runtime handled an editor message itself. */
  onMessage?(message: EditorMessage): void
}

export function startRuntime(config: RuntimeConfig, options: RuntimeOptions = {}): PageRuntime {
  const win = options.win ?? window
  const doc = options.doc ?? win.document
  const parent = options.parent ?? (win.parent as MessageTargetLike)
  const index = new TagIndex(doc)
  const values = new ValueApplier(index, doc)
  let lastReport = ''
  const reportedProblems = new Set<string>()
  let stopObserving: () => void = () => {}
  // The runaway guard (`tagGuard`): once paused, nothing is scanned or written.
  const guard = tagGuard()
  let paused: PausedPayload | null = null
  /**
   * `localStorage['eelzap:debug']` set (any value) on the site's origin:
   * `console.debug('[zap:fields]', …)` for every tags report and its cause,
   * and every editor message dropped (a wrong session drops them all).
   */
  let debug = false
  try {
    debug = !!win.localStorage.getItem('eelzap:debug')
  } catch {
    // Blocked storage: no logs.
  }
  const log = (...args: unknown[]) => debug && console.debug('[zap:fields]', ...args)

  const overlay = new Overlay({
    doc,
    win,
    index,
    onInspect: (tagged) => {
      const { x, y, width: w, height: h } = tagged.element.getBoundingClientRect()
      bridge.post('zap:click', {
        recordRef: tagged.recordRef,
        fieldKey: tagged.fieldKey,
        rect: { x, y, w, h },
      })
    },
    onSelect: (elements) =>
      bridge.post('zap:select', {
        anchors: elements.map((element) => buildAnchor(element, index, config.pageUrl(), doc, win)),
      }),
    onSpot: (anchor) => bridge.post('zap:spot', { ...anchor, pageUrl: config.pageUrl() }),
    onPin: (pin) => bridge.post('zap:pin', pin),
    // Zap's one comment toggle: a click on the page or a wrapper is a spot.
    spotOnLarge: true,
  })

  const bridge = createPageBridge({
    win,
    parent,
    editorOrigins: config.editorOrigins,
    preHelloTargets: config.preHelloTargets,
    // Any window may post to the page: only drops from the editor are news.
    onDrop: (reason) => reason !== 'wrong-source' && log('drop', reason),
    onMessage: (message) => {
      if (config.accept && !config.accept(message)) return
      handle(message)
      config.onMessage?.(message)
    },
  })

  const scroll = createScrollSync(win, doc, index, (payload) => bridge.post('zap:scroll', payload))
  /** Comparar's marks, by field: re-resolved to elements after every rescan. */
  let marks: DiffMark[] = []
  const drawMarks = () =>
    overlay.setMarks(
      marks.flatMap(({ recordRef, fieldKey, tone, label, active }) =>
        index
          .byField(recordRef, fieldKey)
          .map(({ element }) => ({ element, tone, label, active: !!active })),
      ),
    )

  function handle(message: EditorMessage): void {
    switch (message.type) {
      case 'zap:hello': {
        const hello = message.payload
        greeted = true
        overlay.mount()
        overlay.setLabels(hello.labels, hello.foreign)
        overlay.setTheme(hello.theme)
        if (hello.zoom !== undefined) overlay.setZoom(hello.zoom)
        overlay.setMode(hello.mode)
        // The editor may have missed the load-time report (it was not
        // listening yet), so the hello is answered with the current tags.
        report('hello', true)
        // A pause before the hello never reached the editor.
        if (paused) bridge.post('zap:paused', paused)
        return
      }
      case 'zap:values':
        if (!paused) values.apply(message.payload)
        return
      case 'zap:focus-field':
        overlay.focusField(
          index.byField(message.payload.recordRef, message.payload.fieldKey).map((t) => t.element),
        )
        return
      case 'zap:mode':
        overlay.setMode(message.payload)
        return
      case 'zap:zoom':
        overlay.setZoom(message.payload.zoom)
        return
      case 'zap:refresh':
        log('refresh')
        win.location.reload()
        return
      case 'zap:highlight': {
        const found = message.payload.anchors
          .map((anchor) => findAnchorElement(anchor, index, doc, win))
          .filter((element): element is Element => element !== null)
        overlay.highlight(found)
        return
      }
      case 'zap:pins': {
        const pins = []
        for (const { id, n, spot, dom } of message.payload.pins) {
          // A dom pin whose element is gone is not drawn (like a highlight).
          const element = dom ? findAnchorElement(dom, index, doc, win) : null
          if (spot) pins.push({ id, n, spot })
          else if (element) pins.push({ id, n, element })
        }
        overlay.setPins(pins)
        return
      }
      case 'zap:scroll-sync':
        scroll.setEnabled(message.payload.enabled)
        return
      case 'zap:scroll-to':
        scroll.scrollTo(message.payload)
        return
      case 'zap:marks':
        marks = message.payload.marks
        drawMarks()
        return
    }
  }

  function report(why: string, force = false): void {
    const summary: TagSummary[] = index.summary()
    const key = JSON.stringify(summary)
    if (force || key !== lastReport) {
      lastReport = key
      bridge.post('zap:tags', summary)
      log('tags', why, summary.length, config.pageUrl(), bridge.session)
    }
    reportProblems(index.problems)
  }

  function reportProblems(problems: TagProblem[]): void {
    for (const problem of problems) {
      const key = `${problem.attribute}=${problem.value}`
      if (reportedProblems.has(key) || reportedProblems.size >= MAX_PROBLEM_REPORTS) continue
      reportedProblems.add(key)
      bridge.post('zap:error', { code: 'TAG_INVALID', detail: key.slice(0, 500) })
    }
  }

  // A client-side route change (pushState) moves the page without a load; it
  // shows up as DOM mutations, so the rescan notices the new URL and tells the
  // editor. A real navigation loads a new document, which says ready again.
  let lastUrl = config.pageUrl()
  /** Rescan; false once the guard paused the page (it stops observing, writes nothing more). */
  function scan(page: boolean): boolean {
    if (paused) return false
    index.scan()
    const count = index.elements.length
    const reason = guard(count, page)
    if (!reason) return true
    paused = { reason, count }
    stopObserving()
    console.warn('eelzap: preview paused', paused)
    bridge.post('zap:paused', paused)
    return false
  }

  function refresh(page = true): void {
    if (!scan(page)) return
    values.reapply()
    if (marks.length) drawMarks()
    report(page ? 'mutation' : 'reapply')
    const url = config.pageUrl()
    if (url !== lastUrl) {
      lastUrl = url
      bridge.post('zap:navigate', { url })
    }
  }

  // Listeners go in NOW, at script start (or, with `lazyOverlay`, the overlay's
  // at the verified hello). When the frame navigates, the editor hears of it
  // before the next document can receive anything (see PAGE_UNLOAD_ERROR).
  const onPageHide = () => {
    bridge.post('zap:error', { code: PAGE_UNLOAD_ERROR })
  }
  // A document restored from the back-forward cache never loads again: it
  // says ready again, and the editor answers with its hello.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      log('pageshow')
      announce()
    }
  }
  /** Whether a hello arrived: until then, `zap:ready` is said again. */
  let greeted = false
  const retries: number[] = []
  function announce(): void {
    log('ready', config.pageUrl())
    bridge.post('zap:ready', {
      version: CLIENT_VERSION,
      capabilities: [...CAPABILITIES],
      pageUrl: config.pageUrl(),
      draftRoute: config.draftRoute ?? null,
    })
  }

  if (!config.lazyOverlay) overlay.install()
  win.addEventListener('pagehide', onPageHide)
  win.addEventListener('pageshow', onPageShow)

  function boot(): void {
    if (!config.lazyOverlay) overlay.mount()
    if (scan(true)) {
      stopObserving = observeTags(doc.documentElement, refresh, {
        throttleMs: options.throttleMs,
        ignore: (node) => {
          const host = overlay.hostElement
          return !!host && (node === host || host.contains(node))
        },
      })
    }
    announce()
    report('ready', true)
    // An editor whose listener mounted after this ready (a soft navigation in
    // Zap) never answers it: say it again until a hello comes.
    for (const ms of [500, 1500, 4000])
      retries.push(win.setTimeout(() => greeted || announce(), ms))
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }

  return {
    bridge,
    index,
    overlay,
    refresh,
    destroy() {
      for (const id of retries) win.clearTimeout(id)
      stopObserving()
      scroll.destroy()
      win.removeEventListener('pagehide', onPageHide)
      win.removeEventListener('pageshow', onPageShow)
      overlay.destroy()
      bridge.destroy()
    },
  }
}
