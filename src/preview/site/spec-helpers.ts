import { vi } from 'vitest'

/**
 * Specs only. The suggestion UI renders in CLOSED shadow roots, which the page
 * (and a spec) cannot reach through `host.shadowRoot`. This records each root
 * as it is attached, with the mode it was asked for, so a spec can both read
 * what the person sees and prove the root is closed.
 */
export function captureShadowRoots() {
  const roots: Array<{ host: Element; root: ShadowRoot; mode: ShadowRootMode }> = []
  const original = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = original.call(this, init)
    roots.push({ host: this, root, mode: init.mode })
    return root
  })
  return {
    roots,
    /** The newest suggestion-UI root still in the document (not the overlay's). */
    current(tag = 'eel-zap-site'): ShadowRoot {
      const live = roots.filter((entry) => entry.host.isConnected && entry.host.localName === tag)
      const last = live[live.length - 1]
      if (!last) throw new Error('no shadow root mounted')
      return last.root
    },
  }
}

export function byText(root: ParentNode, text: string, selector = 'button'): HTMLElement | null {
  return (
    (Array.from(root.querySelectorAll(selector)) as HTMLElement[]).find((node) =>
      (node.textContent ?? '').includes(text),
    ) ?? null
  )
}

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
