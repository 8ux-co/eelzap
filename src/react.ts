import * as React from 'react'

import { recordRefsOf, type EntryLike, type RecordRef } from './refs'
import type { PreviewValue, ValuesPayload } from './preview/protocol'

export { bootZapPreview, type ZapBootOptions } from './boot/boot'
export { ZapPreview, type ZapPreviewProps } from './boot/component'
export { recordRefsOf, zapAttrs, type EntryLike } from './refs'

/**
 * `@8ux-co/eelzap/react` (zap-cms-v2 §2.5, §2.7): the preview boot for React
 * sites (`ZapPreview`, `bootZapPreview`) and the hook below. Nothing here
 * bundles the overlay: it loads from the CDN in a preview session, and
 * announces each `zap:values` patch with a window event (`eelzap:values`),
 * which `onValues` and `useZapLiveUpdates` listen to.
 *
 * `useZapLiveUpdates(entry)` returns `entry` with the editor's unsaved values
 * merged in while the page is framed by Zap, and `entry` itself (the same
 * object) otherwise, the shape of Contentful's `useContentfulLiveUpdates`:
 *
 * ```tsx
 * const post = useZapLiveUpdates(props.post)
 * return <h1 {...zapAttrs(post, 'title')}>{post.content.title}</h1>
 * ```
 *
 * The entry is a delivery API item or document (its `content` gets the
 * values) or any object keyed by field (the object itself gets them). Values
 * arrive formatted for display, as the overlay writes them: text, a URL and an
 * email as a string, rich text as its sanitised HTML, an image as
 * `{ url, alt }` merged into what the field held. The boot must run somewhere on the page (`ZapPreview`);
 * without it, or outside Zap, the hook never changes anything.
 */

type Patch = Record<string, PreviewValue>

/** One display value as a plain field value, merged into what the field held. */
export function toFieldValue(value: PreviewValue, previous: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if ('text' in value) return value.text
  if ('html' in value) return value.html
  if ('url' in value) return value.url
  if ('email' in value) return value.email
  const image = value.image
  const base =
    previous && typeof previous === 'object' && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {}
  const next: Record<string, unknown> = { ...base }
  if (image.src !== undefined) next.url = image.src
  if (image.alt !== undefined) next.alt = image.alt
  return next
}

/** `entry` with `patch` merged into its `content` (or into itself). Pure. */
export function mergeLiveValues<T>(entry: T, patch: Patch): T {
  const keys = Object.keys(patch)
  if (keys.length === 0 || !entry || typeof entry !== 'object') return entry
  const record = entry as Record<string, unknown>
  const content = record.content
  const target =
    content && typeof content === 'object' && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : record
  const merged: Record<string, unknown> = { ...target }
  for (const key of keys) merged[key] = toFieldValue(patch[key] as PreviewValue, target[key])
  return (target === record ? merged : { ...record, content: merged }) as T
}

/** The window event the overlay announces every `zap:values` patch with. */
export const VALUES_EVENT = 'eelzap:values'

/** A values event's detail, checked enough to merge it safely. */
function readValues(event: Event): ValuesPayload | null {
  const detail = (event as CustomEvent<unknown>).detail as Partial<ValuesPayload> | null
  if (!detail || typeof detail.recordRef !== 'string') return null
  const patch = detail.patch
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null
  return detail as ValuesPayload
}

/** `onValues` for references already resolved. */
export function subscribeRefs(
  refs: readonly RecordRef[],
  handler: (patch: Patch, payload: ValuesPayload) => void,
  win: Window | undefined = typeof window === 'undefined' ? undefined : window,
): () => void {
  if (!win) return () => {}
  const listener = (event: Event) => {
    const payload = readValues(event)
    if (!payload || !refs.includes(payload.recordRef)) return
    try {
      handler(payload.patch, payload)
    } catch (error) {
      // A site handler that throws must not take the others down with it.
      console.error('eelzap: onValues handler failed', error)
    }
  }
  win.addEventListener(VALUES_EVENT, listener)
  return () => win.removeEventListener(VALUES_EVENT, listener)
}

/**
 * Call `handler` with each unsaved-values patch for `entry` while the page is
 * in Zap's preview, for sites that compute things from values (excerpts,
 * lists, counts). Framework-free despite living here. Returns an unsubscribe
 * function; outside a preview it never fires.
 */
export function onValues(
  entry: EntryLike,
  handler: (patch: Patch, payload: ValuesPayload) => void,
): () => void {
  return subscribeRefs(recordRefsOf(entry), handler)
}

export function useZapLiveUpdates<T extends EntryLike>(entry: T): T {
  // Every reference counts: the editor names the record by whichever one the
  // page tagged (the default slug, or a localized one).
  const refsKey = recordRefsOf(entry).join('|')
  const [state, setState] = React.useState<{ refsKey: string; patch: Patch }>({
    refsKey,
    patch: {},
  })

  React.useEffect(() => {
    if (!refsKey) return
    return subscribeRefs(refsKey.split('|'), (patch) => {
      setState((previous) => ({
        refsKey,
        patch: previous.refsKey === refsKey ? { ...previous.patch, ...patch } : { ...patch },
      }))
    })
    // `refsKey` stands for the entry's identity: new data for the same entry
    // keeps the unsaved values on top of it.
  }, [refsKey])

  const patch = state.refsKey === refsKey ? state.patch : null
  return React.useMemo(() => (patch ? mergeLiveValues(entry, patch) : entry), [entry, patch])
}
