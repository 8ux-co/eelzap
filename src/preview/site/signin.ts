import {
  SIGNIN_CHANNEL,
  type CallbackParams,
  type ChunkHandle,
  type SiteContext,
  type StartOptions,
} from './config'
import { SIGNIN_MESSAGES } from './messages'
import {
  authorizeUrl,
  challengeFor,
  checkCallback,
  createState,
  createVerifier,
  exchangeCode,
  returnPathOf,
  savePending,
  takePending,
  type PendingSignIn,
} from './oauth'
import { writeToken } from './token'
import { el, icon, mountHost, TOKENS as T } from './ui'

/**
 * The `signin` chunk (zap-cms-v2 §3.4 steps 2 to 5, ADR 041; boards
 * SitioLanzador, SitioEntrar and SitioRenovacion): loaded only after the
 * opt-in trigger.
 *
 * The launcher «Editar o comentar», with the Shift Z hint above it, opens a
 * panel with «Entrar con Eel». All three sit at the bottom centre, the zone
 * the toolbar takes after sign-in (SitioBarra): sites keep the corners for
 * their own floating buttons (a WhatsApp button, a chat bubble). Signing in opens a popup on Nest's consent
 * screen (or, when the person consented to this site before and is signed in
 * to Eel, a popup Nest answers at once and closes, ADR 041 amendment
 * 2026-10-05); the popup lands back on
 * `{origin}/`, where the core hands the code over `BroadcastChannel('eel-zap')`
 * and closes it. This tab, which alone holds the PKCE verifier and the state,
 * checks both and the issuer, exchanges the code and opens `suggest`.
 *
 * A blocked popup turns into a full-page redirect: the verifier and state wait
 * in `sessionStorage` (`PENDING_STORAGE_KEY`), the state carries the return
 * path, and the callback page finishes here (`options.callback`) and goes back.
 */

const POPUP_NAME = 'eelzap-signin'
const POPUP_FEATURES = 'popup,width=480,height=720'

type Phase = 'closed' | 'open' | 'waiting' | 'error'

export function start(ctx: SiteContext, options: StartOptions = {}): ChunkHandle {
  const { win, doc } = ctx
  const m = SIGNIN_MESSAGES[ctx.locale]
  const host = mountHost(doc, CSS)
  const layer = el(doc, 'div', { class: 'layer' })
  host.root.append(layer)

  const renewing = options.reason === 'expired'
  let phase: Phase = renewing ? 'open' : 'closed'
  let notice: string | null = options.reason === 'expired' ? m.expired : null
  let pending: PendingSignIn | null = null
  let destroyed = false

  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(SIGNIN_CHANNEL)
    channel.onmessage = (event: MessageEvent) => onCallback(event.data)
  } catch {
    // No BroadcastChannel: the popup cannot hand back; the redirect path still works.
  }

  function render(): void {
    if (destroyed) return
    const expanded = phase !== 'closed'
    const launcher = el(
      doc,
      'button',
      {
        class: 'launcher',
        attrs: { type: 'button', 'aria-expanded': String(expanded) },
        on: { click: () => setPhase(expanded ? 'closed' : 'open') },
      },
      [icon(doc, 'zap', 18), m.launcher],
    )
    layer.replaceChildren(launcher, expanded ? panel() : hint())
  }

  /** «Pulsa Shift Z para editar o comentar», above the closed launcher (SitioLanzador). */
  function hint(): HTMLElement | string {
    const key = ctx.shortcut
    if (!key) return ''
    const kbd = (text: string) => el(doc, 'kbd', { text })
    return el(doc, 'span', { class: 'hint', attrs: { role: 'tooltip' } }, [
      `${m.hintBefore} `,
      kbd('Shift'),
      ' ',
      kbd(key.toUpperCase()),
      ` ${m.hintAfter}`,
    ])
  }

  function panel(): HTMLElement {
    const waiting = phase === 'waiting'
    return el(
      doc,
      'div',
      {
        class: 'card panel sheet',
        attrs: { role: 'dialog', 'aria-labelledby': 'eelzap-signin-title' },
      },
      [
        el(doc, 'div', { class: 'head' }, [
          el(doc, 'h2', { attrs: { id: 'eelzap-signin-title' } }, [icon(doc, 'zap', 20), m.title]),
          el(
            doc,
            'button',
            {
              class: 'iconbtn',
              attrs: { type: 'button', 'aria-label': m.close, title: m.close },
              on: { click: () => ctx.close() },
            },
            [icon(doc, 'x')],
          ),
        ]),
        el(doc, 'p', { class: 'muted body', text: waiting ? m.waitingHelp : m.body }),
        notice ? el(doc, 'p', { class: 'notice', attrs: { role: 'status' }, text: notice }) : null,
        el(
          doc,
          'button',
          {
            class: 'btn-dark',
            attrs: { type: 'button', 'data-action': 'sign-in' },
            on: { click: () => void signIn() },
          },
          [icon(doc, 'eel', 18), waiting ? m.retry : m.signIn],
        ),
        waiting
          ? el(doc, 'p', { class: 'muted waiting', attrs: { role: 'status' }, text: m.waiting })
          : null,
        el(doc, 'p', { class: 'muted note' }, [
          icon(doc, 'lock', 13),
          el(doc, 'span', { text: m.note }),
        ]),
      ],
    )
  }

  function setPhase(next: Phase, message: string | null = null): void {
    phase = next
    notice = message
    render()
  }

  async function signIn(): Promise<void> {
    // A stale full-page attempt in this tab is abandoned.
    takePending(win)
    // The popup opens INSIDE the click, before any await, or the browser blocks it.
    const popup = win.open('', POPUP_NAME, POPUP_FEATURES)
    const verifier = createVerifier(win)
    try {
      const challenge = await challengeFor(win, verifier)
      if (popup) {
        const state = createState(win)
        pending = { state, verifier, mode: 'popup' }
        setPhase('waiting')
        popup.location.href = authorizeUrl(ctx, state, challenge)
        return
      }
      // Popup blocked: the whole tab goes to Nest and comes back to this path.
      const { pathname, search, hash } = win.location
      const state = createState(win, `${pathname}${search}${hash}`)
      savePending(win, { state, verifier, mode: 'redirect' })
      win.location.assign(authorizeUrl(ctx, state, challenge))
    } catch {
      popup?.close()
      setPhase('error', m.failed)
    }
  }

  function onCallback(data: unknown): void {
    if (!pending || !data || (data as { type?: unknown }).type !== 'eelzap:callback') return
    const callback = data as Partial<CallbackParams>
    const problem = checkCallback(callback, pending, ctx.authOrigin)
    // Another sign-in's callback (another tab of this site): not ours to judge.
    if (problem === 'state') return
    const used = pending
    pending = null
    if (problem) {
      setPhase('error', m.failed)
      return
    }
    void complete(callback.code!, used.verifier, null)
  }

  async function complete(code: string, verifier: string, returnPath: string | null) {
    try {
      const token = await exchangeCode(ctx, code, verifier)
      writeToken(win, token)
      if (destroyed) return
      if (returnPath && returnPath !== `${win.location.pathname}${win.location.search}`) {
        win.location.replace(returnPath)
        return
      }
      await ctx.open('suggest', renewing ? { reason: 'renewed' } : undefined)
    } catch {
      setPhase('error', m.failed)
    }
  }

  if (options.callback) {
    const stored = takePending(win)
    const problem =
      stored?.mode === 'redirect'
        ? checkCallback(options.callback, stored, ctx.authOrigin)
        : 'state'
    if (problem) {
      setPhase('error', m.failed)
    } else {
      render()
      void complete(options.callback.code, stored!.verifier, returnPathOf(options.callback.state))
    }
  } else {
    render()
  }

  return {
    destroy() {
      destroyed = true
      pending = null
      channel?.close()
      host.destroy()
    },
  }
}

const CSS = `
.launcher { pointer-events: auto; position: fixed; left: 50%; transform: translateX(-50%); bottom: 24px; height: 42px; gap: 8px;
  padding: 0 16px 0 12px; border: 1px solid ${T.border}; border-radius: 999px; background: ${T.bg}; color: ${T.fg};
  box-shadow: 0 10px 15px -3px rgba(15,23,42,.10), 0 4px 6px -4px rgba(15,23,42,.08); }
.hint { pointer-events: none; position: fixed; left: 50%; transform: translateX(-50%); bottom: 76px; display: flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-radius: 9px; background: ${T.dark}; color: #FFFFFF; font-size: 12px; white-space: nowrap; }
kbd { font: 600 11px Poppins, ui-sans-serif, system-ui, sans-serif; padding: 1px 5px; border-radius: 5px;
  background: rgba(255,255,255,.16); color: #FFFFFF; }
.launcher[aria-expanded="true"] { box-shadow: 0 10px 15px -3px rgba(15,23,42,.10), 0 0 0 3px ${T.focus}; }
.panel { left: calc(50% - 160px); bottom: 78px; width: 320px; padding: 16px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.body { margin: 8px 0 14px; }
.notice { margin: 0 0 12px; padding: 8px 10px; border-radius: 9px; background: ${T.goldTint}; color: ${T.goldText}; font-size: 12px; }
.waiting { margin-top: 8px; font-size: 12px; text-align: center; }
.note { margin-top: 10px; display: flex; align-items: flex-start; gap: 6px; font-size: 12px; }
.note .icon { margin-top: 2px; }
`
