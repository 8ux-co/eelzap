import {
  emptyDropStats,
  isDraftRoutePath,
  isPreviewTokenShape,
  envelope,
  isSession,
  MAX_MESSAGE_BYTES,
  messageBytes,
  PAGE_UNLOAD_ERROR,
  parsePageMessage,
  utf8Length,
  type DomAnchor,
  type DropReason,
  type DropStats,
  type EditorMessages,
  type EditorMessageType,
  type HelloPayload,
  type OverlayMode,
  type PageMessage,
  type PageMessages,
  type Pin,
  type PreviewValue,
  type RecordRef,
} from './protocol'

/**
 * The EDITOR side of the bridge (§2.6), for Zap's preview panel. The frame
 * loads the customer's own site by its real URL; the site runs the Zap client
 * (`live.ts`), which answers with `zap:ready`.
 *
 * ```ts
 * const bridge = createEditorBridge({ frame: iframe, pageOrigins, handlers })
 * iframe.src = pageUrl
 * bridge.hello({ siteKey, locale, labels, recordRef, mode: 'inspect', zoom })
 * bridge.setValues(recordRef, locale, formValues)   // debounced, full then deltas
 * ```
 *
 * Detection is the arrival of `zap:ready` and nothing else (§2.2): there is
 * no timer here. A panel that wants to say "the client is not installed"
 * decides for itself how long to wait.
 *
 * ## What is accepted
 *
 * A page message is accepted only when ALL hold:
 *
 * 1. `event.source === frame.contentWindow` (read at event time);
 * 2. `event.origin` is one of `pageOrigins`, the site's own preview origins.
 *    Nothing else, `'null'` (an opaque origin) included;
 * 3. the session matches. `zap:ready` is accepted with an empty session,
 *    because the client cannot know it before the hello;
 * 4. after `zap:ready`, the origin is the one that said ready. A new
 *    document's `zap:ready` (the frame navigated) may come from any of
 *    `pageOrigins` and re-pins.
 *
 * Then the envelope must parse (known page to editor type, valid payload,
 * at most 256 KB). Every drop is counted in `stats`; nothing throws.
 *
 * `zap:error` with code `PAGE_UNLOAD` (sent from the page's `pagehide`) holds
 * everything for the next document's `zap:ready`, which is answered with the
 * last hello again. `onError` still fires.
 *
 * ## What the page tells us is a HINT, never an instruction
 *
 * The customer's own scripts share the window with the client and can read
 * the session from the hello, so they can forge `zap:click`, `zap:select`,
 * `zap:tags` and `zap:navigate`. The worst a forged message can do is focus a
 * field, propose anchors the user then sees and submits themselves, or ask
 * for a navigation the panel still checks against the site's preview origins.
 * Handlers must treat payloads that way (no writes on a page message alone).
 *
 * ## Posting
 *
 * Only to the exact origin that said `zap:ready`, never `'*'`. Nothing is
 * posted before `zap:ready`; everything but the hello waits for the hello.
 */

export const VALUES_DEBOUNCE_MS = 120

/** A 128-bit random session id, lowercase hex (§2.6). */
export function createSession(cryptoImpl: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface EditorBridgeHandlers {
  /**
   * `page.origin` is the origin the ready came from, already checked against
   * `pageOrigins`: the only origin to join the announced `draftRoute`
   * to (`draftModeUrl`).
   */
  onReady?(payload: PageMessages['zap:ready'], page: { origin: string }): void
  onTags?(tags: PageMessages['zap:tags']): void
  onClick?(payload: PageMessages['zap:click']): void
  onSelect?(payload: PageMessages['zap:select']): void
  onNavigate?(payload: PageMessages['zap:navigate']): void
  onError?(payload: PageMessages['zap:error']): void
  /** Spot mode: the user clicked the page here (`pins` capability). */
  onSpot?(payload: PageMessages['zap:spot']): void
  /** A drawn pin was clicked (`pins` capability). */
  onPin?(payload: PageMessages['zap:pin']): void
  /** The page's runaway guard stopped following the page; it writes no more values. */
  onPaused?(payload: PageMessages['zap:paused']): void
  onDrop?(reason: DropReason): void
}

export interface FrameLike {
  readonly contentWindow: Window | null
}

export interface EditorBridgeOptions {
  frame: FrameLike
  /** The site's preview origins; the only origins heard and posted to. Required, non-empty. */
  pageOrigins: readonly string[]
  /** Defaults to a fresh `createSession()`. */
  session?: string
  handlers?: EditorBridgeHandlers
  /** The editor's window (where messages arrive). Default `window`. */
  win?: Window
  debounceMs?: number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export interface EditorBridgeStats extends DropStats {
  /** Outgoing values dropped because one field alone exceeded the cap. */
  'oversize-out': number
}

export interface EditorBridge {
  readonly session: string
  readonly ready: boolean
  readonly stats: EditorBridgeStats
  /** Send `zap:hello` (as soon as the page is ready). */
  hello(payload: Omit<HelloPayload, 'session'>): void
  /**
   * The CURRENT values of the record, already formatted (`PreviewValue`).
   * Debounced; the first send (and any send for another record or locale) is
   * the full set, later sends only the fields that changed. Split across
   * messages to stay under 256 KB.
   */
  setValues(recordRef: RecordRef, locale: string, values: Record<string, PreviewValue>): void
  /** Send pending values now (e.g. before switching records). */
  flushValues(): void
  focusField(recordRef: RecordRef, fieldKey: string): void
  setMode(mode: OverlayMode): void
  setZoom(zoom: number): void
  /** Reload the page in place; only for a page whose `zap:ready` advertised `refresh`. */
  refresh(): void
  highlight(anchors: DomAnchor[]): void
  /**
   * The numbered pins to draw (≤ 50), only for a page whose `zap:ready`
   * advertised `pins`. Identical consecutive sets are sent once; a new
   * document starts with none, so send its pins again from `onReady`.
   */
  setPins(pins: Pin[]): void
  destroy(): void
}

type Outgoing = {
  [K in EditorMessageType]: { type: K; payload: EditorMessages[K] }
}[EditorMessageType]

export interface DraftModeUrlInput {
  /** The frame's VERIFIED origin: `onReady`'s `page.origin`, never the payload's. */
  origin: string
  /** `zap:ready`'s `draftRoute`, a path the page announced. */
  draftRoute: string | null | undefined
  /** The preview token minted for this load (`zpt_…`). */
  token: string
  /** The page path to land on after the exchange (`/blog/hola`). */
  path: string
}

/**
 * The draft-mode URL to load in the frame (§2.5, §7.5):
 * `{origin}{draftRoute}?token=…&path=…`, or null when anything is off. The
 * page names only a PATH; the host is always the frame's verified origin, so
 * a hostile page cannot route the token elsewhere: a route that is not a
 * plain path (`isDraftRoutePath`), an origin that is not a bare http(s)
 * origin, a token not shaped like Zap's or a path that is not
 * origin-relative all return null, and the result is checked to sit on
 * `origin` once more.
 */
export function draftModeUrl(input: DraftModeUrlInput): string | null {
  const { origin, draftRoute, token, path } = input
  if (!isDraftRoutePath(draftRoute) || !isPreviewTokenShape(token)) return null
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null
  let url: URL
  try {
    const base = new URL(origin)
    if ((base.protocol !== 'https:' && base.protocol !== 'http:') || base.origin !== origin) {
      return null
    }
    url = new URL(draftRoute, base)
  } catch {
    return null
  }
  if (url.origin !== origin || url.pathname !== draftRoute) return null
  url.search = new URLSearchParams({ token, path }).toString()
  return url.toString()
}

export function createEditorBridge(options: EditorBridgeOptions): EditorBridge {
  const win = options.win ?? window
  const session = options.session ?? createSession()
  if (!isSession(session)) throw new Error('eelzap: session must be 32 lowercase hex chars')
  const handlers = options.handlers ?? {}
  const setT = options.setTimeout ?? ((fn, ms) => win.setTimeout(fn, ms))
  const clearT = options.clearTimeout ?? ((h) => win.clearTimeout(h as number))
  const debounceMs = options.debounceMs ?? VALUES_DEBOUNCE_MS
  const pageOrigins = (options.pageOrigins ?? []).filter(
    (origin) => typeof origin === 'string' && origin !== '' && origin !== 'null',
  )
  if (pageOrigins.length === 0) {
    throw new Error('eelzap: the editor bridge needs the site preview origins')
  }

  const stats: EditorBridgeStats = { ...emptyDropStats(), 'oversize-out': 0 }
  let ready = false
  let destroyed = false
  let pageOrigin: string | null = null
  let helloSent = false
  let pendingHello: Outgoing | null = null
  /** The hello to answer a new document's `zap:ready` with. */
  let lastHello: Extract<Outgoing, { type: 'zap:hello' }> | null = null
  let currentMode: OverlayMode | null = null
  let currentZoom: number | null = null
  /** The last pins sent to this document, to skip identical re-sends. */
  let sentPins: string | null = null
  const queue: Outgoing[] = []

  // Values state.
  let pendingValues: {
    recordRef: RecordRef
    locale: string
    values: Record<string, PreviewValue>
  } | null = null
  let valuesTimer: unknown = null
  let sentScope: string | null = null
  const sentJson = new Map<string, string>()

  const drop = (reason: DropReason) => {
    stats[reason]++
    handlers.onDrop?.(reason)
  }

  function post(message: Outgoing): void {
    const target = options.frame.contentWindow
    if (!target || destroyed || !ready || pageOrigin === null) return
    const data = envelope(message.type, session, message.payload)
    if (messageBytes(data) > MAX_MESSAGE_BYTES) {
      stats['oversize-out']++
      return
    }
    // Never '*': only the exact origin that said ready.
    target.postMessage(data, pageOrigin)
  }

  function send(message: Outgoing): void {
    if (message.type === 'zap:hello') {
      if (!ready) {
        pendingHello = message
        return
      }
      helloSent = true
      post(message)
      while (queue.length) post(queue.shift()!)
      return
    }
    if (!ready || !helloSent) {
      queue.push(message)
      return
    }
    post(message)
  }

  const listener = (event: MessageEvent) => {
    if (destroyed) return
    const frameWindow = options.frame.contentWindow
    if (!frameWindow || event.source !== frameWindow) return drop('wrong-source')
    if (!pageOrigins.includes(event.origin)) return drop('wrong-origin')
    const parsed = parsePageMessage(event.data)
    if (!parsed.ok) return drop(parsed.reason)
    const message: PageMessage = parsed.message

    const readyBeforeHello = message.type === 'zap:ready' && message.session === ''
    if (message.session !== session && !readyBeforeHello) return drop('wrong-session')
    // Pinned to the document that said ready; a new document's ready may come
    // from any preview origin and re-pins.
    if (message.type !== 'zap:ready' && pageOrigin !== null && event.origin !== pageOrigin) {
      return drop('wrong-origin')
    }

    switch (message.type) {
      case 'zap:ready': {
        const again = ready || pageOrigin !== null
        ready = true
        pageOrigin = event.origin
        let hello: Outgoing | null = pendingHello
        pendingHello = null
        if (again) {
          helloSent = false
          sentPins = null
          sentScope = null
          sentJson.clear()
          queue.length = 0
          if (!hello && lastHello) {
            hello = {
              type: 'zap:hello',
              payload: {
                ...lastHello.payload,
                ...(currentMode ? { mode: currentMode } : {}),
                ...(currentZoom !== null ? { zoom: currentZoom } : {}),
              },
            }
          }
        }
        handlers.onReady?.(message.payload, { origin: event.origin })
        if (hello) send(hello)
        return
      }
      case 'zap:tags':
        return handlers.onTags?.(message.payload)
      case 'zap:click':
        return handlers.onClick?.(message.payload)
      case 'zap:select':
        return handlers.onSelect?.(message.payload)
      case 'zap:navigate':
        return handlers.onNavigate?.(message.payload)
      case 'zap:spot':
        return handlers.onSpot?.(message.payload)
      case 'zap:pin':
        return handlers.onPin?.(message.payload)
      case 'zap:paused':
        return handlers.onPaused?.(message.payload)
      case 'zap:error':
        if (message.payload.code === PAGE_UNLOAD_ERROR) {
          // Hold everything for the next document's ready.
          ready = false
          helloSent = false
        }
        return handlers.onError?.(message.payload)
    }
  }

  win.addEventListener('message', listener)

  function flushValues(): void {
    if (valuesTimer !== null) clearT(valuesTimer)
    valuesTimer = null
    const pending = pendingValues
    pendingValues = null
    if (!pending) return
    const scope = `${pending.recordRef}|${pending.locale}`
    if (scope !== sentScope) {
      sentScope = scope
      sentJson.clear()
    }
    const changed: Array<[string, PreviewValue, string]> = []
    for (const [key, value] of Object.entries(pending.values)) {
      const json = JSON.stringify(value) ?? 'null'
      if (sentJson.get(key) === json) continue
      changed.push([key, value, json])
    }
    if (changed.length === 0) return
    // Pack fields into messages under the cap; a single field over it is dropped.
    const overhead = 512 + utf8Length(pending.recordRef) + utf8Length(pending.locale)
    let patch: Record<string, PreviewValue> = {}
    let size = overhead
    const flush = () => {
      if (Object.keys(patch).length === 0) return
      send({
        type: 'zap:values',
        payload: { recordRef: pending.recordRef, locale: pending.locale, patch },
      })
      patch = {}
      size = overhead
    }
    for (const [key, value, json] of changed) {
      const entry = utf8Length(json) + utf8Length(key) + 4
      if (overhead + entry > MAX_MESSAGE_BYTES) {
        stats['oversize-out']++
        continue
      }
      if (size + entry > MAX_MESSAGE_BYTES) flush()
      patch[key] = value
      size += entry
      sentJson.set(key, json)
    }
    flush()
  }

  return {
    session,
    get ready() {
      return ready
    },
    stats,
    hello(payload) {
      const message = { type: 'zap:hello' as const, payload: { ...payload, session } }
      lastHello = message
      currentMode = payload.mode
      if (payload.zoom !== undefined) currentZoom = payload.zoom
      send(message)
    },
    setValues(recordRef, locale, values) {
      pendingValues = { recordRef, locale, values }
      if (valuesTimer !== null) clearT(valuesTimer)
      valuesTimer = setT(flushValues, debounceMs)
    },
    flushValues,
    focusField(recordRef, fieldKey) {
      send({ type: 'zap:focus-field', payload: { recordRef, fieldKey } })
    },
    setMode(mode) {
      currentMode = mode
      send({ type: 'zap:mode', payload: mode })
    },
    setZoom(zoom) {
      currentZoom = zoom
      send({ type: 'zap:zoom', payload: { zoom } })
    },
    refresh() {
      send({ type: 'zap:refresh', payload: {} })
    },
    highlight(anchors) {
      send({ type: 'zap:highlight', payload: { anchors } })
    },
    setPins(pins) {
      const json = JSON.stringify(pins)
      if (json === sentPins) return
      sentPins = json
      send({ type: 'zap:pins', payload: { pins } })
    },
    destroy() {
      destroyed = true
      win.removeEventListener('message', listener)
      if (valuesTimer !== null) clearT(valuesTimer)
    },
  }
}

export {
  CAPABILITIES,
  isDraftRoutePath,
  isPin,
  isSession,
  MAX_ANCHORS,
  MAX_MESSAGE_BYTES,
  MAX_PINS,
  PAGE_UNLOAD_ERROR,
  parsePageMessage,
  type Capability,
  type ClickPayload,
  type DomAnchor,
  type DropReason,
  type HelloPayload,
  type OverlayMode,
  type PageAnchor,
  type PageMessage,
  type PageMessages,
  type PausedPayload,
  type Pin,
  type PreviewValue,
  type RecordRef,
  type SpotAnchor,
  type SpotPayload,
  type SpotPoint,
  type TagSummary,
} from './protocol'
