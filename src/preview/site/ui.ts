/**
 * The site tools' building blocks, shared by the `signin` and `suggest`
 * chunks (zap-cms-v2 §2.7, §7.3):
 *
 * - **A closed Shadow DOM** on a custom element appended to `<html>`, styled
 *   `all: initial` with `!important` inline, so the site's CSS cannot restyle
 *   it, it cannot restyle the site, and site scripts get no `shadowRoot`.
 * - **Eel tokens inlined** (`TOKENS`): the boards' colours, radii and Poppins
 *   with system fallbacks; nothing is fetched.
 * - **Text only.** `el()` takes text as text: strings become text nodes, never
 *   markup. The single `innerHTML` is `icon()`, which reads a constant SVG from
 *   `ICONS` by name; no network string ever reaches it.
 */

export const SITE_HOST_TAG = 'eel-zap-site'

const ZAP_BOLT =
  '<svg viewBox="0 0 512 512"><g transform="matrix(27.611111,0,0,24.833333,-74.833333,-42)"><path d="M13,2L3,14L10.036,11.906L10,22L20.964,9.235L12.913,11.973L13,2Z" fill="#F1A10D" stroke="#F1A10D" stroke-width="0.5"/><path d="M13,2L6.518,12.953L10.036,11.906L12.913,11.973L13,2Z" fill="#FFC03A"/><path d="M10.036,11.906L10,22L20.964,9.235L12.913,11.973L10.036,11.906Z" fill="#D98A05"/><path d="M10,22L20.964,9.235L16.939,10.604L10,22Z" fill="#BF7500"/></g></svg>'

const EEL_MARK =
  '<svg viewBox="0 0 3000 3000" fill="currentColor"><g transform="matrix(1.01772,-0.122618,0.122163,1.013948,-241.899218,117.348723)"><g transform="matrix(1.192409,0,0,1.144788,-367.077609,-248.030951)"><path d="M2789.774,1920.921C2642.929,2454.806 2170.478,2846 1611,2846C934.352,2846 385,2273.795 385,1569C385,864.205 934.352,292 1611,292C1849.726,292 2072.607,363.224 2261.109,486.366C2132.562,436.833 1991.613,409.484 1843.83,409.484C1242.576,409.484 754.435,862.18 754.435,1419.774C754.435,1977.368 1242.576,2430.064 1843.83,2430.064C2248.492,2430.064 2601.918,2225.006 2789.774,1920.921Z"/></g><g transform="matrix(1.434867,0,-0,0.933341,-1232.183743,68.591241)"><path d="M2196.648,369.772C2557.019,431.746 2832,753.678 2832,1141C2832,1572.598 2490.559,1923 2070,1923C1813.847,1923 1587.045,1793.01 1448.867,1593.857C1561.131,1687.675 1700.963,1743.353 1852.482,1743.353C2222.082,1743.353 2522.15,1412.061 2522.15,1004.003C2522.15,734.845 2391.596,499.086 2196.648,369.772Z"/></g></g></svg>'

const stroke = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

/** Constant markup only. Adding an icon means adding a literal here. */
export const ICONS = {
  zap: ZAP_BOLT,
  eel: EEL_MARK,
  x: stroke('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  lock: stroke(
    '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  ),
  pointer: stroke(
    '<path d="M12.586 12.586 19 19"/><path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"/>',
  ),
  pencil: stroke(
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  ),
  commentPlus: stroke(
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
  ),
  thread: stroke(
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>',
  ),
  exit: stroke(
    '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  ),
  check: stroke('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  alert: stroke('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
  field: stroke('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
} as const

export type IconName = keyof typeof ICONS

export function icon(doc: Document, name: IconName, size = 15): HTMLElement {
  const span = doc.createElement('span')
  span.className = 'icon'
  span.style.width = `${size}px`
  span.style.height = `${size}px`
  span.setAttribute('aria-hidden', 'true')
  // A constant from ICONS, never network data (§7.3).
  span.innerHTML = ICONS[name]
  return span
}

type Child = Node | string | number | null | undefined | false

export interface ElProps {
  class?: string
  attrs?: Record<string, string | null | undefined>
  text?: string
  on?: Partial<Record<string, (event: Event) => void>>
}

/** An element whose children are nodes or TEXT. Strings are never parsed as markup. */
export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: ElProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)
  if (props.class) node.className = props.class
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value !== null && value !== undefined) node.setAttribute(name, value)
  }
  if (props.text !== undefined) node.textContent = props.text
  for (const [type, handler] of Object.entries(props.on ?? {})) {
    if (handler) node.addEventListener(type, handler)
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child)
  }
  return node
}

export interface SiteHost {
  host: HTMLElement
  root: ShadowRoot
  destroy(): void
}

/** The closed shadow host, on `<html>` so a site that replaces `<body>` keeps it. */
export function mountHost(doc: Document, css: string): SiteHost {
  const host = doc.createElement(SITE_HOST_TAG)
  const style: Record<string, string> = {
    all: 'initial',
    position: 'fixed',
    inset: '0',
    'pointer-events': 'none',
    'z-index': '2147483647',
    display: 'block',
  }
  for (const [name, value] of Object.entries(style))
    host.style.setProperty(name, value, 'important')
  const root = host.attachShadow({ mode: 'closed' })
  const sheet = doc.createElement('style')
  sheet.textContent = BASE_CSS + css
  root.append(sheet)
  doc.documentElement.appendChild(host)
  return { host, root, destroy: () => host.remove() }
}

/** Initials for an avatar: first letters of the first two words. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
}

/** Eel tokens, inlined (boards SitioLanzador to SitioRenovacion). */
export const TOKENS = {
  fg: '#010313',
  muted: '#5A6C85',
  border: '#E2E8F0',
  bg: '#FFFFFF',
  subtle: '#EAEEF3',
  primary: '#287CCF',
  primaryBorder: '#4B97DE',
  dark: '#0F172B',
  gold: '#9A6200',
  goldTint: '#FDF3E1',
  goldText: '#7A4D00',
  danger: '#C62828',
  focus: 'rgba(144,161,185,0.5)',
}

const T = TOKENS
const FONT = 'Poppins, ui-sans-serif, system-ui, sans-serif'

const BASE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer { position: fixed; inset: 0; pointer-events: none; font-family: ${FONT}; color: ${T.fg};
  font-size: 13px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
.icon { display: inline-flex; flex-shrink: 0; }
.icon svg { width: 100%; height: 100%; display: block; }
button { font: 500 13px ${FONT}; color: inherit; cursor: pointer; border: 0; background: transparent;
  display: inline-flex; align-items: center; gap: 6px; padding: 0; margin: 0; }
button:focus-visible, textarea:focus-visible, input:focus-visible { outline: none; box-shadow: 0 0 0 3px ${T.focus}; }
button:disabled { opacity: .55; cursor: default; }
.card { pointer-events: auto; position: fixed; background: ${T.bg}; border: 1px solid ${T.border};
  border-radius: 15px; box-shadow: 0 20px 25px -5px rgba(15,23,42,.12), 0 8px 10px -6px rgba(15,23,42,.08); }
.muted { color: ${T.muted}; }
h2 { margin: 0; font: 600 15px ${FONT}; color: ${T.fg}; display: flex; align-items: center; gap: 8px; }
p { margin: 0; }
.iconbtn { width: 28px; height: 28px; justify-content: center; border-radius: 7px; color: ${T.muted}; }
.iconbtn:hover { background: ${T.subtle}; }
.btn { height: 34px; padding: 0 14px 0 11px; border-radius: 9px; white-space: nowrap; flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.btn-outline { border: 1px solid ${T.border}; background: ${T.bg}; color: ${T.fg}; }
.btn-primary { border: 1px solid ${T.primaryBorder}; background: ${T.primary}; color: #FAFAFA; }
.btn-dark { width: 100%; height: 38px; justify-content: center; gap: 8px; border-radius: 9px;
  background: ${T.dark}; color: #FFFFFF; }
.error { color: ${T.danger}; font-size: 12px; }
@media (max-width: 480px) { .card.sheet { left: 8px !important; right: 8px !important; width: auto !important; } }
`
