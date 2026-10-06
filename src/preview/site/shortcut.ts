/**
 * The keyboard shortcut that opens «Editar» and «Comentar» on the live site
 * (zap-cms-v2 §3.4, owner 2026-10-05): Shift plus one letter, `Z` by default.
 * It replaced «Shift twice», which fired while people typed capitals.
 *
 * Shared by the boot every visitor runs (`src/boot/boot.ts`, under 1 KB) and
 * the overlay core (`./boot.ts`), so the two can never disagree about what
 * counts. No directive, no imports.
 *
 * It never fires while the person is typing: focus in an input, a textarea, a
 * select or anything editable, or a key that is part of an IME composition
 * (`isComposing`, or the legacy `keyCode` 229 some browsers send instead).
 */

/** The letter pressed with Shift when a site sets none. */
export const DEFAULT_SHORTCUT = 'Z'

/**
 * Where typing happens: the target itself or anything it sits in. Any
 * `contenteditable`, even `false`, counts: a few bytes of the boot cheaper,
 * and a missed shortcut there costs nothing.
 */
const TYPING = 'input,textarea,select,[contenteditable]'

export function isShortcut(event: KeyboardEvent, key: string): boolean {
  // The real target, inside an open shadow root too (a site's own components).
  const target = (event.composedPath?.()[0] ?? event.target) as Element | null
  return (
    event.shiftKey &&
    !(event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing) &&
    // Some browsers report a key inside an IME composition only as keyCode 229.
    event.keyCode !== 229 &&
    event.key?.toLowerCase() === key.toLowerCase() &&
    !target?.closest?.(TYPING)
  )
}
