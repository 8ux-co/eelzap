import { buildAnchor, normalizeText } from '../anchor'
import { Overlay, OVERLAY_HOST_TAG, reveal as scrollTo, type OverlayPin } from '../overlay'
import type { OverlayMode } from '../protocol'
import { observeTags, tagGuard, TagIndex, type PauseReason, type TaggedElement } from '../tags'
import {
  createComment,
  fetchOnPage,
  newIdempotencyKey,
  saveToDraft,
  type ApiAnchor,
  type ApiFailure,
  type FieldInfo,
  type OnPage,
  type OnPageComment,
  type RawValue,
} from './api'
import type { ChunkHandle, SiteContext, StartOptions } from './config'
import { barDrag, DRAG_CSS } from './drag'
import {
  DRAFT_SESSION_MESSAGES,
  inDraftSession,
  leaveDraftSession,
  requestDraftSession,
  rememberEditIntent,
  takeEditIntent,
} from './draft-session'
import { SUGGEST_MESSAGES } from './messages'
import { isShortcut } from './shortcut'
import {
  buildCreateBody,
  buildDraftBody,
  currentPageUrl,
  editableText,
  editKindFor,
  fieldOf,
  inputSpec,
  parseInput,
  parseProposed,
  pinsFor,
  proposableField,
  recordFor,
  sameRaw,
  sameValue,
  spotAnchor,
  toApiAnchor,
  type EditKind,
  type Proposal,
} from './suggestion'
import { createTokenSession, SESSION_MESSAGES } from './session'
import { clearToken, readSession } from './token'
import { el, icon, initials, kbd, mountHost, TOKENS as T, type IconName } from './ui'

/**
 * The `suggest` chunk: «Editar» and «Comentar» on the live site (zap-cms-v2
 * §3.4, owner 2026-10-05; boards SitioBarra, SitioEditar, SitioSugerencia,
 * SitioEnviado, SitioRenovacion), loaded only once this tab holds a site
 * client token. The file keeps its old name so the CDN chunk keeps its own.
 *
 * - **Toolbar** (SitioBarraEstados): the grip, Navegar, Editar and Comentar,
 *   the page's open comments, the account chip and the hide arrow. Navegar
 *   intercepts nothing and still shows the pins.
 * - **Account menu**: who you are, «Abrir en Zap» (the editor of the record
 *   this page is, Zap's `viewer.editorUrl`, else Zap's home) and
 *   «Cerrar sesión en Zap», which forgets the token as Salir did. A menu
 *   button: arrows, Home and End move, Escape closes back to the chip, an
 *   outside press or Tab closes it.
 * - **Paused** (the runaway guard, `tags.ts` `tagGuard`): a page over the
 *   tagged cap at boot, or whose tagged count keeps growing on its own, stops
 *   being followed: no more scans or pins, Editar and Comentar off, and a
 *   quiet «Vista previa pausada» card over the bar with «Recargar» (the
 *   pill says it in its label).
 * - **Hidden**: the hide arrow or Shift Z (the site's shortcut; never while
 *   typing, editing or writing a comment) folds the bar into a pill with the
 *   bolt and the open count, in the bar's place; a click or Shift Z brings it
 *   back. Remembered per origin with the bar's place (`drag.ts`).
 * - **Editar** (only while the site's ADMIN leaves `liveEditing` on; off, the
 *   tool shows disabled with «Desactivado por un administrador»): the overlay
 *   outlines tagged fields; a click on a TEXT or LONG_TEXT field makes it
 *   editable in place; URL, NUMBER, INTEGER, CURRENCY (in major units),
 *   DATE and DATETIME open a native input with the field's constraints, an
 *   ENUM its options, a BOOLEAN a switch, each in a card beside the element
 *   that takes focus and gives it back. Leaving the field, Enter or a pick
 *   saves the new value straight to the record's draft through Zap's save
 *   path and says «Guardado en el borrador»; Escape puts it back; the same
 *   value saves nothing. A value the site formats itself reloads the page in
 *   place after the save (`showSaved`). Rich text, media and any other type
 *   say «Este campo se edita en Zap» with «Abrir en Zap» (the owning record,
 *   at the field) and «Comentar». Nothing reaches the site's visitors until
 *   an ADMIN publishes in Zap.
 * - **Comentar**: the overlay outlines any element and consumes the click; a
 *   click opens the composer anchored to that element, or to the point
 *   clicked when the element is most of the page. Shift, Cmd or Ctrl click
 *   gathers several elements for one comment. «Solicitar cambio» makes it a
 *   change request, which Zap assigns to the record's Responsable; on a single
 *   tagged text field it may carry «Proponer texto».
 * - **Pins**: the page's open comments (Zap's `on-page` read) as the
 *   overlay's numbered gold pins, the same numbers as the editor's list; a
 *   pin, or the count, opens the list.
 *
 * Everything renders in closed shadow roots as text (`ui.ts`, the overlay's
 * pins are `textContent` numbers). Excerpts, names and labels from Zap are
 * set with `textContent`; stored selectors only ever reach `safeQueryAll`.
 */

type Mode = 'navigate' | 'edit' | 'comment'

const OVERLAY_MODE: Record<Mode, OverlayMode> = {
  navigate: 'off',
  edit: 'inspect',
  comment: 'select',
}

/** The pin of the comment being written, never a thread id. */
const PENDING_PIN = 'eelzap:pending'

/** An element taking at least this share of the viewport is commented as a point. */
const LARGE_SHARE = 0.5

const TOAST_MS = 8000
/** «Guardado en el borrador» shows this long before a value the site formats reloads the page. */
const RELOAD_AFTER_SAVE_MS = 700
const SAVED_MS = 4000

interface Composer {
  elements: Element[]
  /** The point clicked, in viewport pixels, when the comment is on a point. */
  point: { x: number; y: number } | null
  pin: OverlayPin | null
  recordRef: string
  pageUrl: string
  anchors: ApiAnchor[]
  /** The one tagged text field a proposal may change, else null. */
  tagged: TaggedElement | null
  field: FieldInfo | null
  before: string
  card: HTMLElement
  textarea: HTMLTextAreaElement
  request: boolean
  proposing: boolean
  proposal: HTMLInputElement | HTMLTextAreaElement | null
  error: HTMLElement
  sendButton: HTMLButtonElement
  busy: boolean
  idempotency: { payload: string; key: string } | null
}

interface Editing {
  element: HTMLElement
  tagged: TaggedElement
  field: FieldInfo
  kind: EditKind
  recordRef: string
  pageUrl: string
  anchors: ApiAnchor[]
  before: string
  /** ENUM, BOOLEAN, numbers and dates: the stored value the editor opened with. */
  raw: RawValue | undefined
  /** ENUM and BOOLEAN: what is picked now. */
  picked: RawValue | undefined
  /** Where focus goes back when the editor closes. */
  returnFocus: Element | null
  /** Put the element back exactly as it was. */
  revert: () => void
  /** Stop editing, keeping what was typed. */
  keep: () => void
  card: HTMLElement | null
  input: HTMLInputElement | null
  done: boolean
}

export function start(ctx: SiteContext, options: StartOptions = {}): ChunkHandle {
  const { win, doc } = ctx
  const stored = readSession(win, ctx.siteId)
  if (!stored) {
    void ctx.open('signin', { reason: 'expired' })
    return { destroy() {} }
  }
  // The token lifecycle (`session.ts`): every call gets a valid token, a 401
  // renews once and retries, and the hour is renewed ahead of time.
  const auth = createTokenSession(ctx, stored, { onExpired: () => expire() })
  const sm = SESSION_MESSAGES[ctx.locale]
  const m = SUGGEST_MESSAGES[ctx.locale]
  const dm = DRAFT_SESSION_MESSAGES[ctx.locale]
  // Editar asked for a draft session on this page and the tab came back in
  // draft mode: reopen Editar once the page read says it is allowed.
  let reopenEdit = takeEditIntent(win)
  /**
   * The flag says this tab is in a draft session, but the page came back
   * untagged (the site's dev server restarted and its draft cookie no longer
   * counts): the exchange runs again, once. Never on a load that an exchange
   * (or a save) itself brought, so it cannot loop.
   */
  let retryDraft = !reopenEdit

  const host = mountHost(doc, CSS + DRAG_CSS)
  const layer = el(doc, 'div', { class: 'layer' })
  const marks = el(doc, 'div', { class: 'marks' })
  const bottom = el(doc, 'div', { class: 'bottom' })
  // One tooltip for the bar's buttons, outside the toolbar: its horizontal scroll would clip it.
  const tip = el(doc, 'div', { class: 'tip', attrs: { role: 'tooltip' } })
  layer.append(marks, bottom, tip)
  const drag = barDrag(win, doc, bottom, m.move, m.moveTip)
  const key = ctx.shortcut ? ctx.shortcut.toUpperCase() : null
  host.root.append(layer)

  let mode: Mode = 'navigate'
  let selection: Element[] = []
  let data: OnPage | null = null
  let refused = false
  /** The session ran out and could not be renewed: «Volver a entrar». */
  let expired = false
  let composer: Composer | null = null
  let editing: Editing | null = null
  let list: OnPageComment[] | null = null
  let toast: { title: string; body: string; error?: boolean } | null = null
  /** «Este campo se edita en Zap» beside the field clicked in Editar, until closed. */
  let info: { tagged: TaggedElement; card: HTMLElement } | null = null
  let toastTimer: number | null = null
  let status: 'saving' | 'saved' | 'preparing' | null = null
  let statusTimer: number | null = null
  let frame: number | null = null
  let destroyed = false
  let pins: OverlayPin[] = []
  let numbers = new Map<string, number>()
  let lastClick = { x: 0, y: 0, additive: false }
  let menuOpen = false
  /** The `data-action` to focus after the next render. */
  let focusNext: string | null = null
  /** The next render shows the bar or the pill coming in (a toggle). */
  let entering = false
  let paused: PauseReason | null = null

  // Before the overlay installs its own capture listeners, so this one runs
  // first and still sees clicks the overlay consumes: where, and whether the
  // person was gathering elements.
  const onClickFirst = (event: MouseEvent) => {
    lastClick = {
      x: event.clientX,
      y: event.clientY,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
    }
  }
  win.addEventListener('click', onClickFirst, true)
  // A press anywhere on the page closes the account menu. Presses inside the
  // shadow root reach the window as the host; the layer sorts those out.
  const onPressFirst = (event: PointerEvent) => {
    if (event.target === host.host) return
    if (menuOpen) setMenu(false)
    // A press on the page leaves an open editor (saved, as leaving a text
    // field is) and closes «Este campo se edita en Zap».
    if (editing?.card && !editing.done) commitEdit(editing)
    if (info) closeInfo()
  }
  win.addEventListener('pointerdown', onPressFirst, true)
  layer.addEventListener('pointerdown', (event) => {
    if (!menuOpen) return
    const keep = Array.from(bottom.querySelectorAll('.menu, [data-action="account"]'))
    if (!keep.some((node) => node.contains(event.target as Node))) setMenu(false)
  })

  const index = new TagIndex(doc)
  index.scan()
  const overlay = new Overlay({
    doc,
    win,
    index,
    pinsWhenOff: true,
    ignore: (target) => target === host.host,
    onInspect: (tagged) => beginEdit(tagged),
    onSelect: (elements) => onSelect(elements),
    onPin: ({ id }) => {
      if (id === PENDING_PIN) return
      const found = data?.comments.find((comment) => comment.id === id)
      if (!found) return
      list = [found]
      // A pin on the page while the bar is folded: the bar comes back with the thread.
      if (drag.hidden()) setHidden(false, false)
      else renderBottom()
    },
  })
  overlay.mount()
  // Both hosts sit at the top z-index, so document order decides: the bar
  // and its cards (this host) after the overlay's boxes, chips and pins.
  doc.documentElement.appendChild(host.host)

  // The runaway guard: a page over the cap is never observed; one that keeps
  // growing on its own stops being followed.
  const check = tagGuard()
  let stopObserving = () => {}
  const atBoot = check(index.elements.length, true)
  if (atBoot) {
    // Before the bar's first render, which shows it; the tools start on Navegar.
    paused = atBoot
    console.warn(`eelzap: preview paused (${atBoot})`)
  } else
    stopObserving = observeTags(
      doc.documentElement,
      (page) => {
        index.scan()
        const reason = check(index.elements.length, page)
        if (reason) pause(reason)
        else placePins()
      },
      {
        ignore: (node) => {
          const own = overlay.hostElement
          return node === host.host || (!!own && (node === own || own.contains(node)))
        },
      },
    )

  function pause(reason: PauseReason): void {
    if (paused) return
    paused = reason
    stopObserving()
    console.warn(`eelzap: preview paused (${reason})`)
    if (destroyed) return
    // Pins would drift on a page no longer followed: take them down.
    overlay.setPins([])
    setMode('navigate')
  }

  // ── Loading the page's context ──────────────────────────────────────────

  async function load(): Promise<void> {
    const refs = Array.from(new Set(index.elements.map((tagged) => tagged.recordRef)))
    const result = await auth.call((token) => fetchOnPage(ctx, token, currentPageUrl(win), refs))
    if (destroyed) return
    if (!result.ok) {
      onFailure(result)
      return
    }
    const first = data === null
    data = result.data
    // Labels by key for the page's own records; by tag, with «en …», for
    // fields of another record (a site-wide document in the header).
    const labels: Record<string, string> = {}
    const foreign: Record<string, [string, string]> = {}
    for (const [ref, fields] of Object.entries(data.fields ?? {})) {
      const name = data.records?.[ref]
      for (const [key, field] of Object.entries(fields)) {
        if (typeof field?.label !== 'string') continue
        if (name) foreign[`${ref}#${key}`] = [field.label, m.inRecord(name)]
        else labels[key] = field.label
      }
    }
    overlay.setLabels(labels, foreign)
    if (!data.liveEditing && mode === 'edit') setMode('navigate')
    if (reopenEdit) {
      reopenEdit = false
      if (canEdit()) setMode('edit')
    }
    if (first && options.reason === 'renewed') {
      const name = data.viewer?.name
      setToast({ title: m.renewed, body: name ? m.renewedAs(name) : m.renewedBody })
    }
    renderBottom()
    placePins()
  }

  function onFailure(failure: ApiFailure, during: 'read' | 'comment' | 'edit' = 'read'): void {
    if (failure.kind === 'expired') {
      expire()
      return
    }
    if (failure.kind === 'forbidden' && during === 'edit') {
      // «Editar» was turned off since the page read: the tool goes disabled.
      if (data) data.liveEditing = false
      setMode('navigate')
      setToast({ title: m.editOff, body: m.editOffBody, error: true })
      return
    }
    if (failure.kind === 'refused' || failure.kind === 'forbidden') {
      refused = true
      closeComposer()
      overlay.setMode('off')
      overlay.setPins([])
      renderBottom()
      return
    }
    const message = failure.kind === 'rate' ? m.rateLimited(failure.retryAfter) : m.failed
    if (during === 'comment' && composer) showError(message)
    else
      setToast({ title: during === 'edit' ? m.saveFailed : m.failed, body: message, error: true })
  }

  function expire(): void {
    clearToken(win)
    if (expired || destroyed) return
    // «Tu sesión de Zap expiró» with «Volver a entrar», not the refused card:
    // the person has access, their hour (and its renewal) ran out.
    expired = true
    closeComposer()
    overlay.setMode('off')
    renderBottom()
  }

  /** «Volver a entrar»: the sign-in starts inside this click, so the popup is allowed. */
  function signInAgain(): void {
    void ctx.open('signin', { reason: 'expired', signIn: true })
  }

  // ── Toolbar, tray, list, status, toast ──────────────────────────────────

  function canEdit(): boolean {
    return !!data?.liveEditing
  }

  function setMode(next: Mode): void {
    if ((next === 'edit' && !canEdit()) || (paused && next !== 'navigate')) return
    if (status === 'preparing') return
    // A page rendered outside draft mode carries no tags (no stega, empty
    // `attrs`): Editar first takes the tab through a draft session
    // (`draft-session.ts`), unless this tab is already in one.
    if (next === 'edit' && !index.elements.length && (retryDraft || !inDraftSession(win))) {
      retryDraft = false
      void prepareEdit()
      return
    }
    endEdit()
    closeComposer()
    closeInfo()
    mode = next
    selection = []
    overlay.clearSelection()
    overlay.setMode(OVERLAY_MODE[next])
    // In draft mode and still untagged: the page has no fields, so it says why.
    if (next === 'edit' && !index.elements.length)
      setToast({ title: m.noFields, body: m.noFieldsBody })
    renderBottom()
  }

  /**
   * Editar on an untagged page: exchange the site-client token for a draft
   * session and take the tab through the site's draft route; the page comes
   * back tagged and Editar reopens. On failure, the «no fields» empty state
   * with the reason.
   */
  async function prepareEdit(): Promise<void> {
    setStatus('preparing')
    const token = await auth.ensure()
    if (token === null || destroyed) return
    const result = await requestDraftSession(ctx, token)
    if (destroyed) return
    if (result.ok) {
      // Stays «Preparando la edición…» until the page unloads.
      win.location.assign(result.url)
      return
    }
    setStatus(null)
    if (result.reason === 'expired') {
      expire()
      return
    }
    const body =
      result.reason === 'no-route'
        ? dm.noRoute
        : result.reason === 'rate'
          ? dm.rate(result.retryAfter)
          : dm.failed
    setToast({ title: m.noFields, body, error: result.reason !== 'no-route' })
  }

  function renderBottom(): void {
    if (destroyed) return
    hideTip()
    // A render replaces the bar: keep focus on the same control.
    const active = host.root.activeElement?.getAttribute('data-action')
    const hidden = drag.hidden()
    const children: HTMLElement[] = []
    if (toast) children.push(toastCard(toast))
    if (expired) {
      children.push(expiredCard())
      bottom.replaceChildren(...children)
      drag.place()
      marks.replaceChildren()
      return
    }
    if (refused) {
      children.push(refusedCard())
      bottom.replaceChildren(...children)
      drag.place()
      marks.replaceChildren()
      return
    }
    if (paused && !hidden) children.push(pausedCard(paused))
    if (list && !hidden) children.push(listCard(list))
    if (selection.length > 0 && !composer && !hidden) children.push(trayCard())
    if (status) {
      children.push(
        el(doc, 'div', { class: 'card status', attrs: { role: 'status' } }, [
          status === 'saved' ? icon(doc, 'check', 14) : null,
          status === 'saved' ? m.saved : status === 'preparing' ? dm.preparing : m.saving,
        ]),
      )
    }
    if (menuOpen && !hidden) children.push(menuCard())
    const bar = hidden ? pill() : toolbar()
    if (entering) bar.setAttribute('data-enter', '')
    entering = false
    children.push(bar)
    bottom.replaceChildren(...children)
    drag.place()
    drawMarks()
    const want = focusNext ?? active
    focusNext = null
    if (want)
      bottom.querySelector<HTMLElement>(`[data-action="${want}"]`)?.focus({ preventScroll: true })
  }

  function openCount(): [number, string] {
    const open = data?.comments.length ?? 0
    return [open, data?.truncated ? `${open}+` : String(open)]
  }

  function setMenu(open: boolean, focus: string | null = null): void {
    if (menuOpen === open && !focus) return
    menuOpen = open
    focusNext = focus
    renderBottom()
  }

  /** Bar to pill and back. `fromUi`: focus follows to the other control. */
  function setHidden(value: boolean, fromUi: boolean): void {
    if (refused || drag.hidden() === value) return
    if (value) {
      endEdit()
      closeComposer()
      selection = []
      overlay.clearSelection()
      list = null
      menuOpen = false
    }
    drag.setHidden(value)
    overlay.setMode(value ? 'off' : OVERLAY_MODE[mode])
    focusNext = fromUi ? (value ? 'show' : 'hide') : null
    entering = true
    renderBottom()
  }

  /** The bar's tooltip (SitioBarraEstados) with the shortcut's key chip, on hover and keyboard focus. */
  function withTip(target: HTMLElement, text: string, end: boolean): HTMLElement {
    const show = () => {
      tip.replaceChildren(text)
      if (key) tip.append(kbd(doc, 'Shift', key))
      tip.classList.add('on')
      const rect = target.getBoundingClientRect()
      const vw = doc.documentElement.clientWidth || win.innerWidth
      const w = tip.offsetWidth
      // Over the bar: 8px off its edge (the hide arrow sits 7px inside it), under it when the bar opens down.
      const gap = end ? 15 : 8
      const x = end ? rect.right + 7 - w : rect.left + (rect.width - w) / 2
      tip.style.left = `${Math.min(Math.max(x, 8), vw - w - 8)}px`
      tip.style.top = bottom.hasAttribute('data-below')
        ? `${rect.bottom + gap}px`
        : `${rect.top - gap - tip.offsetHeight}px`
    }
    const focus = () => {
      try {
        if (target.matches(':focus-visible')) show()
      } catch {
        show()
      }
    }
    for (const [type, handler] of [
      ['mouseenter', show],
      ['focus', focus],
      ['mouseleave', hideTip],
      ['blur', hideTip],
      ['pointerdown', hideTip],
    ] as const) {
      target.addEventListener(type, handler)
    }
    if (key) target.setAttribute('aria-keyshortcuts', `Shift+${key}`)
    return target
  }

  function hideTip(): void {
    tip.classList.remove('on')
  }

  function avatar(name: string | null, large = false): HTMLElement {
    return el(doc, 'span', {
      class: large ? 'avatar lg' : 'avatar',
      attrs: { 'aria-hidden': 'true' },
      text: initials(name),
    })
  }

  function menuCard(): HTMLElement {
    const name = data?.viewer?.name ?? null
    const email = data?.viewer?.email ?? null
    const item = (action: string, label: string, glyph: IconName, run: () => void) =>
      el(
        doc,
        'button',
        {
          class: 'mi',
          attrs: { type: 'button', role: 'menuitem', tabindex: '-1', 'data-action': action },
          on: {
            click: run,
            pointerenter: (event) => (event.currentTarget as HTMLElement).focus(),
          },
        },
        [icon(doc, glyph), label],
      )
    return el(
      doc,
      'div',
      {
        class: 'card menu',
        attrs: { role: 'menu', 'aria-label': m.accountMenu, tabindex: '-1', 'data-action': 'menu' },
        on: { keydown: onMenuKey },
      },
      [
        el(doc, 'div', { class: 'menu-head' }, [
          avatar(name, true),
          el(doc, 'div', { class: 'menu-who' }, [
            el(doc, 'span', { class: 'menu-name', text: name ?? m.someone }),
            email ? el(doc, 'span', { class: 'menu-mail', text: email }) : null,
          ]),
        ]),
        el(doc, 'div', { class: 'sep', attrs: { role: 'separator' } }),
        item('open-zap', m.openInZap, 'external', () => {
          setMenu(false, 'account')
          win.open(zapUrl(data?.viewer?.editorUrl, ctx.zapOrigin), '_blank', 'noopener')
        }),
        el(doc, 'div', { class: 'sep', attrs: { role: 'separator' } }),
        item('sign-out', m.signOut, 'exit', exit),
      ],
    )
  }

  function onMenuKey(event: Event): void {
    const e = event as KeyboardEvent
    if (e.key === 'Tab') {
      // Close, and let Tab move on from the chip.
      setMenu(false, 'account')
      return
    }
    const items = Array.from(bottom.querySelectorAll<HTMLElement>('.menu [role="menuitem"]'))
    const at = items.indexOf(host.root.activeElement as HTMLElement)
    const to = (
      { ArrowDown: at + 1, ArrowUp: at < 0 ? -1 : at - 1, Home: 0, End: -1 } as Record<
        string,
        number
      >
    )[e.key]
    if (to === undefined) return
    e.preventDefault()
    items[(to + items.length) % items.length]?.focus()
  }

  function pill(): HTMLElement {
    const [open, shown] = openCount()
    // The pill drags like the grip (`drag.ts`); a press that did not move is the click.
    return withTip(
      drag.grab(
        el(
          doc,
          'button',
          {
            class: 'card pill',
            attrs: {
              type: 'button',
              'aria-label':
                m.showBar(open).replace(String(open), shown) + (paused ? `. ${m.paused}` : ''),
              'data-action': 'show',
            },
            on: { click: () => setHidden(false, true) },
          },
          [
            icon(doc, 'zap', 20),
            el(doc, 'span', { class: 'pill-count' }, [icon(doc, 'thread', 14), shown]),
          ],
        ),
      ),
      m.show,
      false,
    )
  }

  function toolbar(): HTMLElement {
    const [open, shown] = openCount()
    const name = data?.viewer?.name ?? null
    const tool = (value: Mode, label: string, glyph: IconName) => {
      const off = (value === 'edit' && !canEdit()) || (!!paused && value !== 'navigate')
      // Disabled by the ADMIN: says so; still loading: just not yet.
      const why = paused && off ? m.paused : off && data ? m.editOff : null
      return el(
        doc,
        'button',
        {
          class: 'seg',
          attrs: {
            type: 'button',
            'aria-pressed': String(mode === value),
            'aria-disabled': off ? 'true' : null,
            title: why,
            'data-tip': why,
            'data-mode': value,
          },
          on: { click: () => setMode(value) },
        },
        [icon(doc, glyph, 14), label],
      )
    }
    return el(
      doc,
      'div',
      { class: 'card toolbar', attrs: { role: 'toolbar', 'aria-label': m.toolbar } },
      [
        drag.handle,
        el(doc, 'span', { class: 'divider', attrs: { 'aria-hidden': 'true' } }),
        icon(doc, 'zap', 20),
        el(doc, 'div', { class: 'segments', attrs: { role: 'group', 'aria-label': m.tools } }, [
          tool('navigate', m.navigate, 'pointer'),
          tool('edit', m.edit, 'pencil'),
          tool('comment', m.comment, 'commentPlus'),
        ]),
        el(doc, 'span', { class: 'divider', attrs: { 'aria-hidden': 'true' } }),
        el(
          doc,
          'button',
          {
            class: 'tool strong',
            attrs: { type: 'button', 'aria-expanded': String(!!list), 'data-action': 'open-list' },
            on: {
              click: () => {
                list = list ? null : (data?.comments ?? [])
                renderBottom()
              },
            },
          },
          [icon(doc, 'thread'), m.open(open).replace(String(open), shown)],
        ),
        el(doc, 'span', { class: 'divider', attrs: { 'aria-hidden': 'true' } }),
        el(
          doc,
          'button',
          {
            class: 'tool account',
            attrs: {
              type: 'button',
              'aria-haspopup': 'menu',
              'aria-expanded': String(menuOpen),
              'aria-label': name ? m.account(name) : m.accountMenu,
              'data-action': 'account',
            },
            on: {
              // A pointer opens onto the menu itself; Enter or Space onto its first item.
              click: (event) =>
                setMenu(
                  !menuOpen,
                  menuOpen ? 'account' : (event as MouseEvent).detail ? 'menu' : 'open-zap',
                ),
              keydown: (event) => {
                const k = (event as KeyboardEvent).key
                if (k !== 'ArrowDown' && k !== 'ArrowUp') return
                event.preventDefault()
                setMenu(true, k === 'ArrowUp' ? 'sign-out' : 'open-zap')
              },
            },
          },
          [avatar(name), icon(doc, 'chevron', 13)],
        ),
        withTip(
          el(
            doc,
            'button',
            {
              class: 'tool hide',
              attrs: { type: 'button', 'aria-label': m.hide, 'data-action': 'hide' },
              on: { click: () => setHidden(true, true) },
            },
            [icon(doc, 'eyeOff', 16)],
          ),
          m.hide,
          true,
        ),
      ],
    )
  }

  function trayCard(): HTMLElement {
    return el(doc, 'div', { class: 'card tray', attrs: { role: 'status' } }, [
      el(doc, 'span', { text: m.selected(selection.length) }),
      el(doc, 'button', {
        class: 'btn btn-outline',
        text: m.clearSelection,
        attrs: { type: 'button' },
        on: {
          click: () => {
            selection = []
            overlay.clearSelection()
            renderBottom()
          },
        },
      }),
      el(doc, 'button', {
        class: 'btn btn-primary',
        text: m.comment,
        attrs: { type: 'button', 'data-action': 'comment-selection' },
        on: {
          click: () => {
            const elements = selection
            selection = []
            overlay.clearSelection()
            openComposer(elements, null)
          },
        },
      }),
    ])
  }

  function listCard(comments: OnPageComment[]): HTMLElement {
    return el(
      doc,
      'div',
      { class: 'card list sheet', attrs: { role: 'dialog', 'aria-label': m.openTitle } },
      [
        el(doc, 'div', { class: 'head' }, [
          el(doc, 'h2', { text: m.openTitle }),
          closeButton(m.dismiss, () => {
            list = null
            renderBottom()
          }),
        ]),
        comments.length === 0
          ? el(doc, 'p', { class: 'muted', text: m.noneOpen })
          : el(
              doc,
              'ul',
              {},
              comments.map((comment) => {
                const n = numbers.get(comment.id)
                return el(doc, 'li', {}, [
                  el(
                    doc,
                    'button',
                    {
                      class: 'item',
                      attrs: { type: 'button', 'data-comment': comment.id },
                      on: { click: () => reveal(comment.id) },
                    },
                    [
                      n ? el(doc, 'span', { class: 'num', text: String(n) }) : null,
                      el(doc, 'span', { class: 'item-text' }, [
                        el(doc, 'span', { class: 'who', text: comment.author?.name || m.someone }),
                        comment.isChangeRequest
                          ? el(doc, 'span', { class: 'flag', text: m.changeRequest })
                          : null,
                        el(doc, 'span', { class: 'what', text: comment.excerpt ?? '' }),
                      ]),
                    ],
                  ),
                ])
              }),
            ),
      ],
    )
  }

  /** Scroll to a thread's pin. */
  function reveal(id: string): void {
    const pin = pins.find((entry) => entry.id === id)
    if (pin?.element) scrollTo(win, pin.element)
    else if (pin?.spot) {
      const root = doc.documentElement
      win.scrollTo?.({
        top: Math.max(0, pin.spot.y * root.scrollHeight - win.innerHeight / 2),
        behavior: 'smooth',
      })
    }
  }

  function toastCard(value: { title: string; body: string; error?: boolean }): HTMLElement {
    return el(
      doc,
      'div',
      {
        class: value.error ? 'card toast toast-error' : 'card toast',
        attrs: { role: 'status', 'aria-live': 'polite' },
      },
      [
        icon(doc, value.error ? 'alert' : 'check', 18),
        el(doc, 'div', { class: 'toast-text' }, [
          el(doc, 'span', { class: 'title', text: value.title }),
          el(doc, 'span', { class: 'muted', text: value.body }),
        ]),
        closeButton(m.dismiss, () => setToast(null)),
      ],
    )
  }

  /** The guard's pause (the editor banner's words), quiet: the refused card's layout, a muted icon. */
  function pausedCard(reason: PauseReason): HTMLElement {
    return el(doc, 'div', { class: 'card refused paused', attrs: { role: 'status' } }, [
      icon(doc, 'alert', 18),
      el(doc, 'div', { class: 'toast-text' }, [
        el(doc, 'span', { class: 'title', text: m.paused }),
        el(doc, 'span', {
          class: 'muted',
          text: reason === 'cap' ? m.pausedCap : m.pausedRunaway,
        }),
      ]),
      el(doc, 'button', {
        class: 'tool',
        text: m.reload,
        attrs: { type: 'button', 'data-action': 'reload' },
        on: { click: () => win.location.reload() },
      }),
    ])
  }

  /** The session ran out (item 32): not a refusal, so the way back is one click. */
  function expiredCard(): HTMLElement {
    return el(doc, 'div', { class: 'card refused', attrs: { role: 'alert' } }, [
      icon(doc, 'alert', 18),
      el(doc, 'div', { class: 'toast-text' }, [
        el(doc, 'span', { class: 'title', text: sm.expiredTitle }),
        el(doc, 'span', { class: 'muted', text: sm.expiredBody }),
      ]),
      el(
        doc,
        'button',
        {
          class: 'tool',
          attrs: { type: 'button', 'data-action': 'sign-in-again' },
          on: { click: signInAgain },
        },
        [icon(doc, 'eel'), sm.signInAgain],
      ),
    ])
  }

  function refusedCard(): HTMLElement {
    return el(doc, 'div', { class: 'card refused', attrs: { role: 'alert' } }, [
      icon(doc, 'alert', 18),
      el(doc, 'div', { class: 'toast-text' }, [
        el(doc, 'span', { class: 'title', text: m.refusedTitle }),
        el(doc, 'span', { class: 'muted', text: m.refusedBody }),
      ]),
      el(
        doc,
        'button',
        { class: 'tool', attrs: { type: 'button', 'data-action': 'exit' }, on: { click: exit } },
        [icon(doc, 'exit'), m.exit],
      ),
    ])
  }

  function closeButton(label: string, onClick: () => void): HTMLElement {
    return el(
      doc,
      'button',
      {
        class: 'iconbtn',
        attrs: { type: 'button', 'aria-label': label, title: label },
        on: { click: onClick },
      },
      [icon(doc, 'x')],
    )
  }

  function setToast(value: typeof toast): void {
    toast = value
    if (toastTimer !== null) win.clearTimeout(toastTimer)
    toastTimer = value ? win.setTimeout(() => setToast(null), TOAST_MS) : null
    renderBottom()
  }

  function setStatus(value: typeof status): void {
    status = value
    if (statusTimer !== null) win.clearTimeout(statusTimer)
    statusTimer = value === 'saved' ? win.setTimeout(() => setStatus(null), SAVED_MS) : null
    renderBottom()
  }

  function exit(): void {
    // Drop this tab's draft session too (revoked at Zap, the cookie through
    // the site's exit route, then a published reload) when it has one.
    void leaveDraftSession(ctx, auth.token(), index.elements.length > 0)
    clearToken(win)
    ctx.close()
  }

  // ── Pins and marks ──────────────────────────────────────────────────────

  function placePins(): void {
    if (destroyed || refused || paused || !data) return
    const placed = pinsFor(data.comments ?? [], index, doc, win)
    pins = placed.pins
    numbers = placed.numbers
    overlay.setPins(composer?.pin ? [...pins, composer.pin] : pins)
  }

  /** The soft gold outline around what is being edited or commented (SitioEditar). */
  function drawMarks(): void {
    const targets = editing ? [editing.element] : (composer?.elements ?? [])
    marks.replaceChildren(
      ...targets
        .filter((element) => element.isConnected)
        .map((element) => {
          const rect = element.getBoundingClientRect()
          const box = el(doc, 'div', { class: 'mark' })
          box.style.left = `${rect.left - 3}px`
          box.style.top = `${rect.top - 3}px`
          box.style.width = `${rect.width + 6}px`
          box.style.height = `${rect.height + 6}px`
          // The field's chip stays above an element edited in a card (SitioEditarOpcion).
          if (editing?.card)
            box.append(
              el(doc, 'span', {
                class: 'mark-chip',
                text: editing.field.label || editing.tagged.fieldKey,
              }),
            )
          return box
        }),
    )
  }

  function schedule(): void {
    if (frame !== null) return
    const raf = win.requestAnimationFrame?.bind(win) ?? ((fn: () => void) => win.setTimeout(fn, 16))
    frame = raf(() => {
      frame = null
      drawMarks()
      if (composer) position(composer.card, anchorRect(composer))
      if (editing?.card)
        position(editing.card, editing.element.getBoundingClientRect(), editing.card.offsetWidth)
      if (info) position(info.card, info.tagged.element.getBoundingClientRect(), 300)
    }) as number
  }

  /**
   * Place a card (an editor, «Este campo se edita en Zap», the composer)
   * beside what it is about: 10px under it, else over it, clear of the
   * viewport's edges AND of the bar (or the pill) wherever it was dragged.
   * Each side is tried as is, then shifted sideways past the bar; when none
   * is clear, the first that fits the viewport wins.
   */
  function position(
    card: HTMLElement,
    rect: Pick<DOMRect, 'left' | 'top' | 'bottom'>,
    preferred = 420,
  ): void {
    const vw = win.innerWidth
    const vh = win.innerHeight
    const width = Math.min(preferred, vw - 16)
    // Measured at its final width: text wraps there.
    card.style.width = `${width}px`
    const height = card.offsetHeight || 260
    const bar = bottom.querySelector('.toolbar, .pill')?.getBoundingClientRect()
    const clampX = (x: number) => Math.min(Math.max(8, x), Math.max(8, vw - width - 8))
    const hits = (x: number, y: number) =>
      !!bar &&
      x < bar.right + 8 &&
      x + width > bar.left - 8 &&
      y < bar.bottom + 8 &&
      y + height > bar.top - 8
    const fits = (y: number) => y >= 8 && y + height <= vh - 8
    let place: [number, number] | null = null
    for (const y of [rect.bottom + 10, rect.top - height - 10]) {
      if (!fits(y)) continue
      for (const x of [
        clampX(rect.left),
        clampX((bar?.right ?? 0) + 8),
        clampX((bar?.left ?? 0) - 8 - width),
      ]) {
        if (!hits(x, y)) {
          place = [x, y]
          break
        }
      }
      if (place) break
    }
    if (!place) {
      const y = fits(rect.bottom + 10) ? rect.bottom + 10 : Math.max(8, rect.top - height - 10)
      place = [clampX(rect.left), y]
    }
    card.style.left = `${place[0]}px`
    card.style.top = `${place[1]}px`
  }

  // ── Comentar ────────────────────────────────────────────────────────────

  function onSelect(elements: Element[]): void {
    if (mode !== 'comment' || composer) return
    if (elements.length === 0) {
      if (selection.length > 0) {
        selection = []
        renderBottom()
      }
      return
    }
    if (lastClick.additive || elements.length > 1) {
      selection = elements
      renderBottom()
      return
    }
    const element = elements[0]!
    overlay.clearSelection()
    if (isLarge(element)) openComposer([], { x: lastClick.x, y: lastClick.y }, element)
    else openComposer([element], null)
  }

  /** Most of the viewport: a wrapper, not the thing the person pointed at. */
  function isLarge(element: Element): boolean {
    const rect = element.getBoundingClientRect()
    const area = Math.max(1, win.innerWidth * win.innerHeight)
    return (rect.width * rect.height) / area >= LARGE_SHARE
  }

  function anchorRect(session: Composer): Pick<DOMRect, 'left' | 'top' | 'bottom'> {
    const first = session.elements[0]
    if (first) return first.getBoundingClientRect()
    const point = session.point ?? { x: 0, y: 0 }
    return { left: point.x, top: point.y, bottom: point.y }
  }

  function openComposer(
    elements: Element[],
    point: { x: number; y: number } | null,
    owner?: Element,
  ): void {
    if (refused || (elements.length === 0 && !point)) return
    const recordRef = recordFor(elements[0] ?? owner ?? doc.body, index)
    if (!recordRef) {
      setToast({ title: m.failed, body: m.noRecord, error: true })
      return
    }
    list = null
    const pageUrl = currentPageUrl(win)
    const anchors: ApiAnchor[] = point
      ? [spotAnchor(point.x, point.y, doc, win)]
      : elements
          .slice(0, 20)
          .map((element) => toApiAnchor(buildAnchor(element, index, pageUrl, doc, win), recordRef))
    const single = elements.length === 1 ? elements[0]! : null
    const own = single ? index.get(single) : null
    const tagged = own && own.recordRef === recordRef ? own : null
    const field = fieldOf(data, tagged)
    const proposable = proposableField(tagged, field)
    const target = single as HTMLElement | null
    const before =
      field?.type === 'URL' && target?.localName === 'a'
        ? (target.getAttribute('href') ?? '')
        : normalizeText(target?.textContent ?? '')
    const spotPin = point ? anchors[0] : null

    const textarea = el(doc, 'textarea', {
      class: 'composer',
      attrs: {
        'aria-label': m.commentLabel,
        rows: '3',
        maxlength: '10000',
        placeholder: m.commentPlaceholder,
      },
    })
    const error = el(doc, 'p', { class: 'error', attrs: { role: 'alert' } })
    const sendButton = el(
      doc,
      'button',
      {
        class: 'btn btn-primary',
        attrs: { type: 'button', 'data-action': 'send' },
        on: { click: () => void submit() },
      },
      [icon(doc, 'commentPlus', 16), m.comment],
    )
    const title = tagged
      ? el(doc, 'span', { class: 'chip' }, [
          icon(doc, 'field', 12),
          field?.label || tagged.fieldKey,
        ])
      : el(doc, 'h2', {
          text: elements.length > 1 ? m.selected(elements.length) : m.commentTitle,
        })
    const extra = el(doc, 'div', { class: 'extra' })
    const card = el(
      doc,
      'div',
      { class: 'card popover sheet', attrs: { role: 'dialog', 'aria-label': m.newComment } },
      [
        el(doc, 'div', { class: 'head' }, [title, closeButton(m.close, closeComposer)]),
        el(doc, 'div', { class: 'content' }, [
          textarea,
          extra,
          error,
          // A dialog footer: a full-bleed rule, Cancelar and the primary (OWNER-PASS 19).
          el(doc, 'div', { class: 'foot' }, [
            el(doc, 'button', {
              class: 'btn btn-outline',
              text: m.cancel,
              attrs: { type: 'button' },
              on: { click: closeComposer },
            }),
            sendButton,
          ]),
        ]),
      ],
    )
    layer.append(card)

    composer = {
      elements,
      point,
      pin:
        spotPin && 'spot' in spotPin
          ? { id: PENDING_PIN, n: (numbers.size || 0) + 1, spot: spotPin.spot }
          : null,
      recordRef,
      pageUrl,
      anchors,
      tagged: proposable ? tagged : null,
      field: proposable ? field : null,
      before,
      card,
      textarea,
      request: false,
      proposing: false,
      proposal: null,
      error,
      sendButton,
      busy: false,
      idempotency: null,
    }
    renderExtra(extra)
    textarea.addEventListener('input', refreshSend)
    // Enter sends, Shift+Enter breaks the line, as the editor's comment box and
    // Swarm's; the Enter that commits an IME candidate never sends.
    textarea.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) {
        return
      }
      event.preventDefault()
      if (!sendButton.disabled) void submit()
    })
    overlay.setMode('off')
    placePins()
    refreshSend()
    renderBottom()
    position(card, anchorRect(composer))
    textarea.focus()
  }

  /** «Solicitar cambio», who receives it, and «Proponer texto» (SitioSugerencia). */
  function renderExtra(extra: HTMLElement): void {
    const session = composer
    if (!session) return
    const toggle = el(
      doc,
      'button',
      {
        class: 'check',
        attrs: {
          type: 'button',
          role: 'checkbox',
          'aria-checked': String(session.request),
          'data-action': 'request-change',
        },
        on: {
          click: () => {
            session.request = !session.request
            if (!session.request) {
              session.proposing = false
              session.proposal = null
            }
            renderExtra(extra)
            refreshSend()
          },
        },
      },
      [el(doc, 'span', { class: 'box', attrs: { 'aria-hidden': 'true' } }), m.requestChange],
    )
    const parts: Array<HTMLElement | null> = [toggle]
    if (session.request) {
      parts.push(el(doc, 'p', { class: 'muted small', text: m.recipient }))
      parts.push(el(doc, 'p', { class: 'muted small', text: m.requestHelp }))
      if (session.tagged && session.field && !session.proposing) {
        parts.push(
          el(
            doc,
            'button',
            {
              class: 'btn btn-outline propose',
              attrs: { type: 'button', 'data-action': 'propose' },
              on: {
                click: () => {
                  session.proposing = true
                  renderExtra(extra)
                  refreshSend()
                  session.proposal?.focus()
                },
              },
            },
            [icon(doc, 'pencil', 14), m.propose],
          ),
        )
      }
      if (session.tagged && session.field && session.proposing) {
        const label = session.field.label || session.tagged.fieldKey
        const input =
          session.field.type === 'LONG_TEXT'
            ? el(doc, 'textarea', {
                class: 'value',
                attrs: { 'aria-label': m.proposal, rows: '3', maxlength: '10000' },
              })
            : el(doc, 'input', {
                class: 'value',
                attrs: {
                  'aria-label': m.proposal,
                  type: 'text',
                  inputmode: session.field.type === 'NUMBER' ? 'decimal' : null,
                },
              })
        input.value = session.proposal?.value ?? session.before
        input.addEventListener('input', refreshSend)
        session.proposal = input
        parts.push(
          el(doc, 'div', { class: 'proposal' }, [
            el(doc, 'div', { class: 'head' }, [
              el(doc, 'span', { class: 'small strong-text', text: `${m.proposalFor} ${label}` }),
              closeButton(m.removeProposal, () => {
                session.proposing = false
                session.proposal = null
                renderExtra(extra)
                refreshSend()
              }),
            ]),
            session.before
              ? el(doc, 'p', { class: 'muted small before' }, [
                  `${m.now} `,
                  el(doc, 'span', { class: 'strong-text', text: session.before }),
                ])
              : null,
            input,
          ]),
        )
      }
    }
    extra.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null))
  }

  /** The proposal typed, null when none or unchanged, `invalid` for a number that is not one. */
  function proposalOf(session: Composer): Proposal | null | 'invalid' {
    if (!session.request || !session.proposing || !session.proposal) return null
    if (!session.tagged || !session.field) return null
    const parsed = parseProposed(session.field.type, session.proposal.value)
    if (!parsed.ok) return 'invalid'
    const before = parseProposed(session.field.type, session.before)
    if (before.ok && sameValue(before.value, parsed.value)) return null
    return { fieldKey: session.tagged.fieldKey, locale: session.tagged.locale, value: parsed.value }
  }

  function refreshSend(): void {
    const session = composer
    if (!session) return
    const proposal = proposalOf(session)
    const comment = session.textarea.value.trim()
    // The primary names what it does: «Comentar», or «Solicitar cambio» once flagged.
    session.sendButton.replaceChildren(
      icon(doc, session.request ? 'pencil' : 'commentPlus', 16),
      session.busy ? m.sending : session.request ? m.requestChange : m.comment,
    )
    // Text, or a parsed proposal that is not empty: either makes a body.
    const proposed = proposal && proposal !== 'invalid' && String(proposal.value) !== ''
    session.sendButton.disabled = session.busy || proposal === 'invalid' || (!comment && !proposed)
    session.error.textContent =
      proposal === 'invalid' ? m.invalidNumber : (session.error.dataset.sticky ?? '')
  }

  function showError(message: string): void {
    if (!composer) return
    composer.error.dataset.sticky = message
    composer.error.textContent = message
  }

  async function submit(): Promise<void> {
    const session = composer
    if (!session || session.busy) return
    const proposal = proposalOf(session)
    if (proposal === 'invalid') return
    const body = buildCreateBody({
      recordRef: session.recordRef,
      pageUrl: session.pageUrl,
      anchors: session.anchors,
      comment: session.textarea.value,
      isChangeRequest: session.request,
      proposal,
    })
    if (!body.body) return
    // One key per payload: a retry of the same request is the same request.
    const payload = JSON.stringify(body)
    if (session.idempotency?.payload !== payload) {
      session.idempotency = { payload, key: newIdempotencyKey(win) }
    }
    session.busy = true
    delete session.error.dataset.sticky
    refreshSend()
    const key = session.idempotency.key
    const result = await auth.call((token) => createComment(ctx, token, body, key))
    if (destroyed || composer !== session) return
    session.busy = false
    if (!result.ok) {
      refreshSend()
      onFailure(result, 'comment')
      return
    }
    closeComposer()
    const assignee = result.data?.thread?.assignee?.name
    setToast(
      body.isChangeRequest
        ? {
            title: m.sentRequest,
            body: m.sentRequestBody(
              typeof assignee === 'string' && assignee ? assignee : null,
              !!body.proposedValues,
            ),
          }
        : { title: m.sentComment, body: m.sentCommentBody },
    )
    void load()
  }

  function closeComposer(): void {
    const session = composer
    if (!session) return
    composer = null
    session.card.remove()
    if (!refused) {
      overlay.setMode(OVERLAY_MODE[mode])
      placePins()
    }
    renderBottom()
  }

  // ── Editar ──────────────────────────────────────────────────────────────

  function beginEdit(tagged: TaggedElement): void {
    if (mode !== 'edit' || refused || !canEdit()) return
    if (editing && !editing.done) {
      if (editing.element === tagged.element) return
      commitEdit(editing)
    }
    const field = fieldOf(data, tagged)
    const kind = editKindFor(tagged, field)
    if (!kind || !field) {
      // Rich text, media and the rest: no editor on the page, a way there instead.
      openInfoCard(tagged)
      return
    }
    closeInfo()
    const element = tagged.element as HTMLElement
    const pageUrl = currentPageUrl(win)
    // The anchor BEFORE any edit: its text quote is what was published.
    const anchors = [toApiAnchor(buildAnchor(element, index, pageUrl, doc, win), tagged.recordRef)]
    const before =
      field.type === 'URL' && element.localName === 'a'
        ? (element.getAttribute('href') ?? '')
        : normalizeText(element.textContent ?? '')
    // The page shows these formatted («1.750 msnm», «Sí»): the editor opens on
    // the stored value Zap sent; an older Zap sends none, and a NUMBER then
    // reads the page's text as before.
    const stored = data?.values?.[tagged.recordRef]?.[tagged.fieldKey]
    const legacy =
      field.type === 'NUMBER' && stored === undefined ? parseProposed('NUMBER', before) : null
    const raw: RawValue | undefined = legacy?.ok ? legacy.value : stored
    const inline = kind === 'text' ? beginInlineEdit(element) : null
    const session: Editing = {
      element,
      tagged,
      field,
      kind,
      recordRef: tagged.recordRef,
      pageUrl,
      anchors,
      before,
      raw,
      picked: raw,
      returnFocus: doc.activeElement,
      revert: inline?.revert ?? (() => {}),
      keep: inline?.keep ?? (() => {}),
      card: null,
      input: null,
      done: false,
    }
    editing = session
    if (inline) {
      element.addEventListener('blur', () => commitEdit(session), { once: true })
      element.focus?.()
    } else if (kind === 'choice') {
      openChoiceCard(session)
    } else if (kind === 'switch') {
      openSwitchCard(session)
    } else {
      openInputCard(session)
    }
    renderBottom()
  }

  /**
   * The editor beside the element (SitioEditarOpcion, Numero, Fecha, SiNo):
   * `body` and the key hint «Enter guarda · Esc cancela», 10px under the
   * element so the field's chip stays above it, flipped above when there is
   * no room. No buttons: Enter (or a pick) saves, Escape cancels, a press
   * outside saves as leaving a text field does.
   */
  function openValueCard(
    session: Editing,
    body: HTMLElement,
    focus: HTMLElement,
    width: number,
  ): void {
    const label = session.field.label || session.tagged.fieldKey
    const card = el(
      doc,
      'div',
      {
        class: 'card editor',
        attrs: { role: 'dialog', 'aria-label': label },
        on: {
          keydown: (event) => {
            const e = event as KeyboardEvent
            // Enter saves from an input or the switch; an option's Enter picks it (a click).
            if (e.key !== 'Enter' || (e.target as Element).getAttribute('role') === 'option') return
            e.preventDefault()
            commitEdit(session)
          },
        },
      },
      [
        body,
        el(doc, 'div', { class: 'keys' }, [
          kbd(doc, 'Enter'),
          m.enterSaves,
          kbd(doc, 'Esc'),
          m.escCancels,
        ]),
      ],
    )
    card.style.width = `${width}px`
    session.card = card
    layer.append(card)
    position(card, session.element.getBoundingClientRect(), width)
    focus.focus()
  }

  /** URL, numbers and dates: a native input with the field's constraints; the page is not touched. */
  function openInputCard(session: Editing): void {
    const { field } = session
    const spec =
      field.type === 'URL'
        ? { type: 'url', text: session.before, min: undefined, max: undefined, step: undefined }
        : inputSpec(field, session.raw)
    const input = el(doc, 'input', {
      class: 'value',
      attrs: {
        'aria-label': field.label || session.tagged.fieldKey,
        type: spec.type,
        min: spec.min === undefined ? null : String(spec.min),
        max: spec.max === undefined ? null : String(spec.max),
        step: spec.step === undefined ? null : String(spec.step),
      },
    })
    input.value = spec.text
    session.input = input
    const unit = field.type === 'CURRENCY' ? (field.currency ?? null) : null
    openValueCard(
      session,
      unit
        ? el(doc, 'div', { class: 'with-unit' }, [
            input,
            el(doc, 'span', { class: 'muted', text: unit }),
          ])
        : input,
      input,
      field.type === 'URL' ? 280 : 220,
    )
  }

  /** ENUM: its options, a check on the current one; a pick saves at once (arrows move). */
  function openChoiceCard(session: Editing): void {
    const buttons = (session.field.options ?? []).map((option) =>
      el(
        doc,
        'button',
        {
          class: 'option',
          attrs: {
            type: 'button',
            role: 'option',
            'aria-selected': String(option.id === session.raw),
            tabindex: '-1',
          },
          on: {
            click: () => {
              session.picked = option.id
              commitEdit(session)
            },
          },
        },
        [
          el(doc, 'span', { class: 'option-label', text: option.label }),
          option.id === session.raw ? icon(doc, 'tick', 14) : null,
        ],
      ),
    )
    const first =
      buttons.find((button) => button.getAttribute('aria-selected') === 'true') ?? buttons[0]!
    first.tabIndex = 0
    const list = el(
      doc,
      'div',
      {
        class: 'options',
        attrs: { role: 'listbox', 'aria-label': m.options(session.field.label) },
        on: {
          keydown: (event) => {
            const e = event as KeyboardEvent
            const at = buttons.indexOf(host.root.activeElement as HTMLButtonElement)
            const to = (
              { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: buttons.length - 1 } as Record<
                string,
                number
              >
            )[e.key]
            if (to === undefined) return
            e.preventDefault()
            buttons[Math.min(buttons.length - 1, Math.max(0, to))]?.focus()
          },
        },
      },
      buttons,
    )
    openValueCard(session, list, first, 230)
  }

  /** BOOLEAN: the field's name and a switch (Space or a click flips it); Enter saves. */
  function openSwitchCard(session: Editing): void {
    session.picked = session.raw === true
    const label = session.field.label || session.tagged.fieldKey
    const toggle = el(
      doc,
      'button',
      {
        class: 'switch',
        attrs: {
          type: 'button',
          role: 'switch',
          'aria-checked': String(session.picked),
          'aria-label': label,
        },
        on: {
          click: () => {
            session.picked = !session.picked
            toggle.setAttribute('aria-checked', String(session.picked))
          },
        },
      },
      [el(doc, 'span', { class: 'knob' })],
    )
    openValueCard(
      session,
      el(doc, 'div', { class: 'switch-row' }, [
        el(doc, 'span', { class: 'title', text: label }),
        toggle,
      ]),
      toggle,
      220,
    )
  }

  /**
   * «Este campo se edita en Zap» (SitioEditarEnZap): rich text, media and any
   * other type, beside the element, with the field named and two ways on:
   * its record's editor in Zap at this field, or Comentar on the element.
   * Quiet, not an error.
   */
  function openInfoCard(tagged: TaggedElement): void {
    closeInfo()
    const field = fieldOf(data, tagged)
    const label = field?.label || tagged.fieldKey
    const card = el(
      doc,
      'div',
      { class: 'card info', attrs: { role: 'dialog', 'aria-label': m.editInZap } },
      [
        icon(doc, 'info', 16),
        el(doc, 'div', { class: 'toast-text' }, [
          el(doc, 'span', { class: 'title', text: m.editInZap }),
          el(doc, 'span', {
            class: 'muted',
            text: m.editInZapBody(label, field?.type ?? '', tagged.recordRef.startsWith('doc:')),
          }),
          el(doc, 'div', { class: 'actions start' }, [
            el(
              doc,
              'button',
              {
                class: 'btn btn-outline',
                attrs: { type: 'button', 'data-action': 'open-field' },
                on: {
                  click: () => {
                    closeInfo()
                    win.open(fieldEditorUrl(tagged), '_blank', 'noopener')
                  },
                },
              },
              [icon(doc, 'external', 14), m.openInZap],
            ),
            el(
              doc,
              'button',
              {
                class: 'btn btn-ghost',
                attrs: { type: 'button', 'data-action': 'comment-field' },
                on: {
                  click: () => {
                    closeInfo()
                    setMode('comment')
                    if (mode === 'comment') openComposer([tagged.element], null)
                  },
                },
              },
              [icon(doc, 'commentPlus', 14), m.comment],
            ),
          ]),
        ]),
      ],
    )
    info = { tagged, card }
    layer.append(card)
    position(card, tagged.element.getBoundingClientRect(), 300)
  }

  function closeInfo(): void {
    info?.card.remove()
    info = null
  }

  /**
   * The editor of the record that OWNS the field, at that field (`?field=`,
   * Zap's locate): `editorUrls` by ref; an older Zap sends only the page's
   * own record, used when the field is that record's; else Zap's home.
   */
  function fieldEditorUrl(tagged: TaggedElement): string {
    const own = !data?.records?.[tagged.recordRef]
    const base =
      data?.editorUrls?.[tagged.recordRef] ?? (own ? data?.viewer?.editorUrl : null) ?? null
    const safe = zapUrl(base, ctx.zapOrigin)
    if (!base) return safe
    try {
      const url = new URL(safe)
      url.searchParams.set('field', tagged.fieldKey)
      return url.href
    } catch {
      return safe
    }
  }

  /** Make the element editable in place; how to put it back, or keep what was typed. */
  function beginInlineEdit(target: HTMLElement): { revert: () => void; keep: () => void } {
    const children = Array.from(target.childNodes)
    const texts: Array<[Text, string]> = []
    const walker = doc.createTreeWalker(target, 4 /* NodeFilter.SHOW_TEXT */)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      texts.push([node as Text, (node as Text).data])
    }
    const hadAttribute = target.getAttribute('contenteditable')
    target.setAttribute('contenteditable', 'plaintext-only')
    if (target.contentEditable !== 'plaintext-only') target.setAttribute('contenteditable', 'true')
    target.setAttribute('spellcheck', 'true')
    const keep = () => {
      if (hadAttribute === null) target.removeAttribute('contenteditable')
      else target.setAttribute('contenteditable', hadAttribute)
      target.removeAttribute('spellcheck')
    }
    return {
      keep,
      revert: () => {
        keep()
        // The SAME nodes back, with their text: a framework holding them keeps working.
        target.replaceChildren(...children)
        for (const [node, text] of texts) node.data = text
      },
    }
  }

  function typedValue(session: Editing): string {
    if (session.input) return session.input.value
    return editableText(session.element)
  }

  function finishEdit(session: Editing, keepTyped: boolean): void {
    session.done = true
    if (keepTyped) session.keep()
    else session.revert()
    session.card?.remove()
    if (editing === session) editing = null
    renderBottom()
    // Focus goes back where it was before the editor opened.
    const back = session.returnFocus as HTMLElement | null
    if (session.card && back?.isConnected) back.focus?.({ preventScroll: true })
  }

  function cancelEdit(session: Editing): void {
    if (session.done) return
    finishEdit(session, false)
  }

  /** Save what was typed or picked to the draft, or put the element back when nothing changed. */
  function commitEdit(session: Editing): void {
    if (session.done) return
    const { field, kind } = session
    // Text and URL compare with what the page showed; the other types with
    // the stored value Zap sent (`sameRaw`).
    const text = kind === 'text' || field.type === 'URL'
    let value: RawValue
    if (text) {
      const parsed = parseProposed(field.type, typedValue(session))
      const before = parseProposed(field.type, session.before)
      if (parsed.ok && before.ok && sameValue(before.value, parsed.value)) {
        finishEdit(session, false)
        return
      }
      if (!parsed.ok) return invalid(session)
      value = parsed.value
    } else if (kind === 'input') {
      // A native number or date input the browser cannot parse ("15,5" where
      // the decimal mark is a point) reports an empty value: that is not a
      // clear, so never save it as one.
      if (session.input?.validity?.badInput) return invalid(session)
      const parsed = parseInput(field, typedValue(session))
      if (!parsed.ok) return invalid(session)
      value = parsed.value
    } else {
      value = session.picked ?? null
    }
    // Nothing changed (stega markers and whitespace aside): put the element
    // back and write nothing, no thread and no draft.
    if (!text && sameRaw(field.type, session.raw, value)) {
      finishEdit(session, false)
      return
    }
    finishEdit(session, true)
    void save(
      session,
      { fieldKey: session.tagged.fieldKey, locale: session.tagged.locale, value },
      kind === 'choice'
        ? field.options?.find((option) => option.id === value)?.label
        : kind === 'switch'
          ? value
            ? m.yes
            : m.no
          : undefined,
    )
  }

  function invalid(session: Editing): void {
    finishEdit(session, false)
    setToast({ title: m.saveFailed, body: m.invalidNumber, error: true })
  }

  async function save(session: Editing, proposal: Proposal, display?: string): Promise<void> {
    setStatus('saving')
    const body = buildDraftBody({
      recordRef: session.recordRef,
      pageUrl: session.pageUrl,
      anchors: session.anchors,
      proposal,
      display,
    })
    // One key for the retry after a renewal too: a 401 wrote nothing, and the
    // same key keeps a doubled answer from saving twice.
    const draftKey = newIdempotencyKey(win)
    const result = await auth.call((token) => saveToDraft(ctx, token, body, draftKey))
    if (destroyed) return
    if (!result.ok) {
      setStatus(null)
      // Zap already holds that value: nothing to save and nothing to undo.
      if (result.kind === 'unchanged') return
      // The page goes back to what is published; nothing was saved.
      session.revert()
      onFailure(result, 'edit')
      return
    }
    setStatus('saved')
    // The next editor on this field opens on what was just saved, not on the
    // page read's value (the page may not reload: an ENUM label in place).
    if (data && session.raw !== undefined)
      (data.values ??= {})[session.recordRef] = {
        ...data.values[session.recordRef],
        [session.tagged.fieldKey]: proposal.value,
      }
    showSaved(session, display)
  }

  /**
   * After a save the page shows the new value. Text is already there (typed
   * in place) and a URL lands in the link's `href` at the next read; an
   * ENUM's label is written into an element tagged by attribute that holds
   * only text. Everything the site formats itself (numbers, dates, a
   * currency, a yes or no, an ENUM inside markup or found by stega) needs the
   * page to render again: it reloads in place (the browser keeps the scroll,
   * the draft session keeps it on the draft) and Editar reopens.
   * The editor preview's rule (`needsRefresh` in Zap).
   */
  function showSaved(session: Editing, display: string | undefined): void {
    const { field, tagged, element } = session
    if (session.kind === 'text' || field.type === 'URL') return
    if (
      field.type === 'ENUM' &&
      display !== undefined &&
      tagged.source === 'attr' &&
      element.children.length === 0
    ) {
      element.textContent = display
      return
    }
    rememberEditIntent(win)
    win.setTimeout(() => win.location.reload(), RELOAD_AFTER_SAVE_MS)
  }

  function endEdit(): void {
    if (editing && !editing.done) commitEdit(editing)
  }

  // ── Page events ─────────────────────────────────────────────────────────

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hideTip()
    if (menuOpen && event.key === 'Escape') {
      event.preventDefault()
      setMenu(false, 'account')
      return
    }
    // Shift Z: bar to pill and back, never while editing a field or writing a comment.
    if (ctx.shortcut && !editing && !composer && isShortcut(event, ctx.shortcut)) {
      setHidden(!drag.hidden(), !!host.root.activeElement)
      return
    }
    if (composer && event.key === 'Escape') {
      event.preventDefault()
      closeComposer()
      return
    }
    if (info && event.key === 'Escape') {
      event.preventDefault()
      closeInfo()
      return
    }
    const session = editing
    if (!session || session.done) return
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit(session)
    } else if (
      event.key === 'Enter' &&
      session.kind === 'text' &&
      event.target === session.element &&
      (session.field.type === 'TEXT' || event.metaKey || event.ctrlKey)
    ) {
      // A one-line field stays one line; Enter (Cmd or Ctrl Enter for long text) saves.
      event.preventDefault()
      commitEdit(session)
    }
  }
  /** Links and forms work in Navegar (or with the bar folded) only. */
  const blocks = () => mode !== 'navigate' && !drag.hidden()
  const onClick = (event: MouseEvent) => {
    // The element being edited may be (or sit in) a link: place the caret, never navigate.
    // The overlay consumes link clicks while it is on; this covers the
    // moments it is off in Editar or Comentar (the composer is open).
    if (
      (editing?.kind === 'text' &&
        !editing.done &&
        editing.element.contains(event.target as Node)) ||
      (blocks() && (event.target as Element).closest?.('a[href],area[href]'))
    ) {
      event.preventDefault()
    }
  }
  const onSubmit = (event: Event) => {
    if (blocks()) event.preventDefault()
  }
  win.addEventListener('keydown', onKey, true)
  win.addEventListener('click', onClick, true)
  win.addEventListener('submit', onSubmit, true)
  win.addEventListener('scroll', schedule, true)
  win.addEventListener('resize', schedule)

  overlay.setMode(drag.hidden() ? 'off' : OVERLAY_MODE[mode])
  renderBottom()
  void load()

  return {
    destroy() {
      endEdit()
      destroyed = true
      closeComposer()
      auth.destroy()
      if (toastTimer !== null) win.clearTimeout(toastTimer)
      if (statusTimer !== null) win.clearTimeout(statusTimer)
      win.removeEventListener('click', onClickFirst, true)
      win.removeEventListener('pointerdown', onPressFirst, true)
      win.removeEventListener('keydown', onKey, true)
      win.removeEventListener('click', onClick, true)
      win.removeEventListener('submit', onSubmit, true)
      win.removeEventListener('scroll', schedule, true)
      win.removeEventListener('resize', schedule)
      stopObserving()
      overlay.destroy()
      drag.destroy()
      host.destroy()
    },
  }
}

/**
 * «Abrir en Zap»: the record's editor URL when Zap sent one (http or https
 * only, never another scheme), else Zap's home.
 */
export function zapUrl(editorUrl: string | null | undefined, zapOrigin: string): string {
  const home = new URL('/', zapOrigin)
  try {
    const url = new URL(editorUrl ?? '')
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  } catch {
    // No URL, or not one: Zap's home.
  }
  return home.href
}

/** Exported for specs: the overlay's own host tag, which the site tools never draw over. */
export { OVERLAY_HOST_TAG }

const CSS = `
.marks { position: fixed; inset: 0; pointer-events: none; }
.mark { position: fixed; border-radius: 4px; outline: 2px solid rgba(207,135,0,.55); }
.bottom { position: fixed; left: 0; right: 0; bottom: 22px; display: flex; flex-direction: column;
  align-items: center; gap: 10px; pointer-events: none; padding: 0 8px; }
.bottom > .card { position: relative; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 4px; white-space: nowrap;
  max-width: 100%; overflow-x: auto; }
.segments { display: inline-flex; gap: 2px; padding: 2px; border-radius: 7px; background: ${T.subtle};
  background: oklch(0.94 0.008 250); }
.seg { position: relative; height: 28px; padding: 0 10px; border-radius: 5px; font-size: 12px; color: ${T.muted}; }
.seg[aria-pressed="true"] { background: ${T.bg}; color: ${T.fg}; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.seg[aria-disabled="true"] { opacity: .5; cursor: default; }
.seg[data-tip]:hover::after { content: attr(data-tip); position: absolute; bottom: 34px; left: 50%;
  transform: translateX(-50%); padding: 6px 10px; border-radius: 9px; background: ${T.dark}; color: #FFFFFF;
  font-size: 12px; white-space: nowrap; }
.tool { height: 30px; padding: 0 9px; border-radius: 9px; color: ${T.muted}; }
/* Hover as the suite's SegmentedControl and ghost button (SitioBarraEstados): a tool on the track
   gets foreground text over white at 60%, no shadow; the bar's own buttons, on the white card, the
   ghost hover: foreground text over slate-100. Both keep the focus ring. */
.seg:not([aria-pressed="true"]):not([aria-disabled="true"]):hover { background: rgba(255,255,255,.6); color: ${T.fg}; }
.tool:hover, .grip:hover, .account[aria-expanded="true"] { background: #F1F5F9; color: ${T.fg}; }
.seg, .tool, .grip, .pill { transition: color .15s cubic-bezier(.4,0,.2,1), background-color .15s cubic-bezier(.4,0,.2,1); }
.seg:focus-visible, .tool:focus-visible, .grip:focus-visible { box-shadow: 0 0 0 3px ${T.focus}; }
/* The account chip and the hide arrow (SitioBarraEstados): ghost buttons, chevrons muted until hover. */
.account { padding: 0 4px 0 2px; gap: 3px; }
.hide { width: 30px; padding: 0; justify-content: center; }
.avatar.lg { width: 32px; height: 32px; }
.menu { width: 260px; padding: 4px; border-radius: 11px; outline: none;
  box-shadow: 0 10px 15px -3px rgba(15,23,42,.1), 0 4px 6px -4px rgba(15,23,42,.08); }
.menu-head { display: flex; align-items: center; gap: 10px; padding: 8px 8px 10px; }
.menu-who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.menu-name { font-weight: 500; }
.menu-mail { font-size: 12px; color: ${T.muted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sep { height: 1px; background: ${T.border}; margin: 4px -4px; }
.menu-head + .sep { margin-top: 0; }
.mi { width: 100%; height: 32px; gap: 9px; padding: 0 8px; border-radius: 7px; font-weight: 400; color: ${T.fg}; }
.mi > .icon { color: ${T.muted}; }
.mi:focus, .mi:focus-visible { outline: none; background: #F1F5F9; box-shadow: none; }
.pill { height: 44px; gap: 8px; padding: 0 12px 0 11px; border-radius: 999px; }
.pill:hover { background: #F8FAFC; }
.pill:focus-visible { box-shadow: 0 0 0 3px ${T.focus}, 0 20px 25px -5px rgba(15,23,42,.12); }
.pill-count { display: inline-flex; align-items: center; gap: 4px; }
.tip { position: fixed; display: inline-flex; align-items: center; gap: 8px; padding: 5px 6px 5px 9px;
  border-radius: 7px; background: #101828; color: #FFFFFF; font-weight: 500; font-size: 12px; line-height: 18px;
  white-space: nowrap; pointer-events: none; }
.tip:not(.on) { display: none; }
[data-enter] { animation: eelzap-in .16s cubic-bezier(.4,0,.2,1); }
@keyframes eelzap-in { from { opacity: 0; transform: scale(.96); } }
@media (prefers-reduced-motion: reduce) { .seg, .tool, .grip, .pill, .switch, .knob { transition: none; } [data-enter] { animation: none; } }
.tool.strong { color: ${T.fg}; }
.divider { width: 1px; height: 22px; background: ${T.border}; }
.avatar { width: 26px; height: 26px; border-radius: 7px; background: #DBEAFE; color: #1D4ED8;
  display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px; }
.status { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 500; }
.status > .icon { color: #16A34A; }
.tray { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; }
.list { width: min(420px, calc(100vw - 16px)); padding: 13px 10px 10px 15px; max-height: 50vh; overflow: auto; }
.list ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.item { width: 100%; text-align: left; align-items: flex-start; gap: 10px; padding: 8px; border-radius: 9px; }
.item:hover { background: ${T.subtle}; }
.num { flex-shrink: 0; width: 22px; height: 22px; border-radius: 999px 999px 999px 0; background: #CF8700;
  color: #FFFFFF; font-weight: 700; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
.item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.who { font-weight: 600; font-size: 12px; }
.flag { font-size: 11px; color: ${T.goldText}; }
.what { font-weight: 400; color: ${T.muted}; overflow-wrap: anywhere; }
.toast, .refused { width: min(340px, calc(100vw - 16px)); display: flex; gap: 11px; padding: 14px 12px 14px 16px;
  align-self: flex-end; margin-right: 16px; }
.refused { align-self: center; margin-right: 0; width: min(420px, calc(100vw - 16px)); align-items: flex-start; }
.toast > .icon { color: #16A34A; }
.refused > .icon, .toast-error > .icon { color: ${T.danger}; }
.paused > .icon, .info > .icon { color: ${T.muted}; }
.editor { min-width: max-content; }
.editor, .info { position: fixed; padding: 8px; border-radius: 7px;
  box-shadow: 0 4px 6px -1px rgba(15,23,42,.08), 0 2px 4px -2px rgba(15,23,42,.06); }
.info { display: flex; gap: 10px; padding: 12px 14px; }
.info > .icon { margin-top: 1px; }
.info .title { font-weight: 500; }
.info .muted { font-size: 12px; }
.actions.start { justify-content: flex-start; margin-top: 10px; gap: 6px; }
.actions.start .btn { height: 28px; gap: 7px; font-size: 12px; }
.btn-ghost { border: 1px solid transparent; }
.btn-ghost:hover { background: ${T.subtle}; }
.keys { display: flex; align-items: center; gap: 5px; margin: 8px 2px 0; font-size: 12px; color: ${T.muted}; white-space: nowrap; }
.editor input.value { height: 34px; border-radius: 8px; }
.with-unit { display: flex; align-items: center; gap: 8px; }
.options { display: flex; flex-direction: column; max-height: 260px; overflow: auto; }
.option { width: 100%; height: 32px; gap: 8px; padding: 0 8px; border-radius: 6px; font-weight: 400; text-align: left; }
.option:hover, .option:focus-visible { background: #F1F5F9; box-shadow: none; }
.option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 2px 0; }
.switch-row .title { font-weight: 500; }
.switch { position: relative; width: 32px; height: 18px; border-radius: 999px; background: #CBD5E1; transition: background .15s; }
.switch[aria-checked="true"] { background: ${T.primary}; }
.knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 999px; background: ${T.bg};
  box-shadow: 0 1px 2px rgba(0,0,0,.15); transition: left .15s; }
.switch[aria-checked="true"] .knob { left: 16px; }
.mark-chip { position: absolute; right: -5px; top: -27px; display: inline-flex; align-items: center; height: 20px;
  padding: 0 7px; border-radius: 6px; background: ${T.gold}; color: #FFFFFF; font: 600 12px Poppins, ui-sans-serif, system-ui, sans-serif;
  white-space: nowrap; }
.toast-text { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.title { font-weight: 600; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.popover { border-radius: 13px; }
.popover > .head { padding: 13px 10px 0 15px; }
.content { display: flex; flex-direction: column; gap: 11px; padding: 10px 15px 15px; }
.extra { display: flex; flex-direction: column; gap: 8px; }
.check { gap: 8px; font-size: 13px; align-self: flex-start; }
.check .box { width: 16px; height: 16px; border-radius: 4px; border: 1px solid #90A1B9; background: ${T.bg}; }
.check[aria-checked="true"] .box { background: ${T.primary}; border-color: ${T.primaryBorder};
  box-shadow: inset 0 0 0 3px ${T.bg}; }
.propose { align-self: flex-start; height: 30px; }
.proposal { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 12px; background: ${T.goldTint}; }
.chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px 0 6px; border-radius: 7px;
  background: ${T.goldTint}; color: ${T.goldText}; font: 400 12px Poppins, ui-sans-serif, system-ui, sans-serif;
  white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.before { overflow-wrap: anywhere; }
.strong-text { color: ${T.fg}; }
.small { font-size: 12px; }
.composer, .value { width: 100%; font: 400 13px/22px Poppins, ui-sans-serif, system-ui, sans-serif; color: ${T.fg};
  border: 1px solid ${T.border}; border-radius: 12px; padding: 8px 12px; background: ${T.bg}; resize: vertical; }
input.value { height: 36px; border-radius: 9px; }
.composer:focus, .value:focus { border-color: #90A1B9; box-shadow: 0 0 0 3px ${T.focus}; outline: none; }
.error:empty { display: none; }
.actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.foot { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin: 2px -15px -15px;
  padding: 11px 15px; border-top: 1px solid ${T.border}; }
.foot .btn { height: 30px; gap: 7px; }
.foot .btn-outline { padding: 0 14px; }
`
