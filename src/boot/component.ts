import { createElement, Fragment, useEffect } from 'react'

import { bootZapPreview, type ZapBootOptions } from './boot'

export type ZapPreviewProps = ZapBootOptions

/**
 * The preview boot as a React component (`@8ux-co/eelzap/react` and, with a
 * default draft route, `@8ux-co/eelzap/next`). Renders nothing; after mount it
 * runs `bootZapPreview`, which loads the overlay only in a preview session.
 *
 * ```tsx
 * <ZapPreview siteKey="verdeorigen" siteId="…uuid…" />
 * ```
 */
export function ZapPreview(props: ZapPreviewProps) {
  const { siteKey, siteId, draftRoute, preview, shortcut, zapOrigin, authOrigin } = props
  useEffect(
    () => bootZapPreview({ siteKey, siteId, draftRoute, preview, shortcut, zapOrigin, authOrigin }),
    [siteKey, siteId, draftRoute, preview, shortcut, zapOrigin, authOrigin],
  )
  return createElement(Fragment)
}
