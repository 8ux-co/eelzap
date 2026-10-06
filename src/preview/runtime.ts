import { buildAnchor, findAnchorElement } from './anchor'
import { Overlay } from './overlay'
import { createPageBridge, type MessageTargetLike, type PageBridge } from './page-bridge'
import { CAPABILITIES, PAGE_UNLOAD_ERROR, type EditorMessage, type TagSummary } from './protocol'
import { observeTags, TagIndex, type TagProblem } from './tags'
import { ValueApplier } from './values'

/**
 * The page runtime: index, overlay, values and bridge, wired together. The
 * Live client (`live.ts`) boots it inside the customer's own page, framed by
 * Zap's editor by its real URL (§2.7).
 */

export const CLIENT_VERSION = '0.10.0'

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
  /** Force a rescan + report now (specs, and after a navigation). */
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

  const overlay = new Overlay({
    doc,
    win,
    index,
    onInspect: (tagged) =>
      bridge.post('zap:click', { recordRef: tagged.recordRef, fieldKey: tagged.fieldKey }),
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
    onMessage: (message) => {
      if (config.accept && !config.accept(message)) return
      handle(message)
      config.onMessage?.(message)
    },
  })

  function handle(message: EditorMessage): void {
    switch (message.type) {
      case 'zap:hello': {
        const hello = message.payload
        overlay.mount()
        overlay.setLabels(hello.labels)
        overlay.setTheme(hello.theme)
        if (hello.zoom !== undefined) overlay.setZoom(hello.zoom)
        overlay.setMode(hello.mode)
        // The editor may have missed the load-time report (it was not
        // listening yet), so the hello is answered with the current tags.
        report(true)
        return
      }
      case 'zap:values':
        values.apply(message.payload)
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
    }
  }

  function report(force = false): void {
    const summary: TagSummary[] = index.summary()
    const key = JSON.stringify(summary)
    if (force || key !== lastReport) {
      lastReport = key
      bridge.post('zap:tags', summary)
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
  function refresh(): void {
    index.scan()
    values.reapply()
    report()
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

  if (!config.lazyOverlay) overlay.install()
  win.addEventListener('pagehide', onPageHide)

  function boot(): void {
    if (!config.lazyOverlay) overlay.mount()
    index.scan()
    stopObserving = observeTags(doc.documentElement, refresh, {
      throttleMs: options.throttleMs,
      ignore: (node) => {
        const host = overlay.hostElement
        return !!host && (node === host || host.contains(node))
      },
    })
    bridge.post('zap:ready', {
      version: CLIENT_VERSION,
      capabilities: [...CAPABILITIES],
      pageUrl: config.pageUrl(),
      draftRoute: config.draftRoute ?? null,
    })
    report(true)
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
      stopObserving()
      win.removeEventListener('pagehide', onPageHide)
      overlay.destroy()
      bridge.destroy()
    },
  }
}
