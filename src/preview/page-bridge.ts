import {
  emptyDropStats,
  envelope,
  MAX_MESSAGE_BYTES,
  messageBytes,
  parseEditorMessage,
  type DropReason,
  type DropStats,
  type EditorMessage,
  type PageMessages,
  type PageMessageType,
} from './protocol'

/**
 * The PAGE side of the bridge (§2.6 "Origins").
 *
 * A message from the editor is accepted only when ALL hold:
 *
 * 1. `event.source === parent` — the window that framed us, nothing else
 *    (another frame, a popup, the page itself posting to itself).
 * 2. `event.origin` is one of `editorOrigins` (the Zap origins the client
 *    trusts). `'null'` (an opaque origin) is never accepted.
 * 3. It parses as a v1 envelope of a known editor to page type, under 256 KB.
 * 4. Its `session` matches. Before `zap:hello` the session is unknown, and
 *    nothing but a hello is accepted; the first valid hello fixes it. After
 *    that, every message must carry it; a second hello with another session
 *    is refused.
 *
 * Every drop is counted in `stats` by reason; nothing throws.
 *
 * Neither side ever posts with `'*'`. The page answers the origin that said
 * hello (before it, each accepted candidate; the browser drops a message whose
 * target is not the parent's real origin). The editor posts only to the exact
 * page origin that said `zap:ready` (`editor.ts`).
 */

export interface MessageTargetLike {
  postMessage(message: unknown, targetOrigin: string): void
}

export interface PageBridgeOptions {
  win: Window
  /** `window.parent` in production; injected in specs. */
  parent: MessageTargetLike
  editorOrigins: readonly string[]
  /**
   * Where to post BEFORE the hello names the editor's origin. Defaults
   * to `editorOrigins`. Every entry must itself be an accepted origin; the
   * browser drops a message whose target is not the parent's real origin.
   */
  preHelloTargets?(): readonly string[]
  onMessage(message: EditorMessage): void
  onDrop?(reason: DropReason): void
}

export interface PageBridge {
  post<K extends PageMessageType>(type: K, payload: PageMessages[K]): boolean
  readonly session: string | null
  readonly stats: DropStats
  destroy(): void
}

export function createPageBridge(options: PageBridgeOptions): PageBridge {
  const stats = emptyDropStats()
  let session: string | null = null
  let helloOrigin: string | null = null
  const origins = options.editorOrigins.filter((o) => typeof o === 'string' && o !== '')

  const isAccepted = (origin: string) =>
    typeof origin === 'string' && origin !== 'null' && origins.includes(origin)

  const drop = (reason: DropReason) => {
    stats[reason]++
    options.onDrop?.(reason)
  }

  const listener = (event: MessageEvent) => {
    if (event.source !== (options.parent as unknown)) return drop('wrong-source')
    if (!isAccepted(event.origin)) return drop('wrong-origin')
    const parsed = parseEditorMessage(event.data)
    if (!parsed.ok) return drop(parsed.reason)
    const message = parsed.message

    if (message.type === 'zap:hello') {
      if (message.payload.session !== message.session) return drop('invalid-payload')
      if (session !== null && message.session !== session) return drop('wrong-session')
      if (session === null) session = message.session
      helloOrigin = event.origin
    } else if (session === null || message.session !== session || helloOrigin === null) {
      // Nothing but a hello is accepted before the hello.
      return drop('wrong-session')
    }
    options.onMessage(message)
  }

  options.win.addEventListener('message', listener)

  return {
    post(type, payload) {
      const message = envelope(type, session ?? '', payload)
      if (messageBytes(message) > MAX_MESSAGE_BYTES) return false
      // Never '*': after the hello we answer the origin that said hello;
      // before it, each allowed origin (a non-matching target is dropped by
      // the browser, so only the real parent receives it).
      const targets = helloOrigin
        ? [helloOrigin]
        : (options.preHelloTargets?.() ?? origins).filter(isAccepted)
      for (const origin of targets) options.parent.postMessage(message, origin)
      return targets.length > 0
    },
    get session() {
      return session
    },
    stats,
    destroy() {
      options.win.removeEventListener('message', listener)
    },
  }
}
