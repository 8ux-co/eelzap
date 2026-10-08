import { randomUUID } from 'node:crypto'

/** Refuse publication unless both cache-busted and ordinary CDN URLs work. */
export async function checkPreviewBundles(urls, fetchBundle, cacheBust = randomUUID()) {
  if (urls.length === 0) throw new Error('Preview CDN preflight failed: no pinned bundle URLs.')
  const failures = []
  for (const pinned of new Set(urls)) {
    const bust = new URL(pinned)
    bust.searchParams.set('eelzap-preflight', cacheBust)
    for (const url of [bust.href, pinned]) {
      try {
        const response = await fetchBundle(url, {
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        })
        if (response.status !== 200) {
          failures.push(`${url}: HTTP ${response.status}`)
          // A miss on an unreleased immutable URL can be cached for a year.
          // Only probe the ordinary URL once its cache-busted request succeeds.
          break
        }
      } catch (error) {
        failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
        break
      }
    }
  }
  if (failures.length) {
    throw new Error(
      `Preview CDN preflight failed; refusing to publish eelzap. Deploy the pinned bundles to Zap first and clear stale CDN misses.\n${failures.join('\n')}`,
    )
  }
}

/** Read only the pinned paths in the generated SDK release module. */
export function pinnedPreviewUrls(releaseSource) {
  const paths = [
    ...releaseSource.matchAll(
      /'(\/js\/preview\/(?:preview|signin|suggest)\.v1\.[0-9a-f]{16}\.js)'/g,
    ),
  ].map((match) => match[1])
  // The SDK boot loads one overlay, which pins both lazy chunks.
  if (
    paths.length !== 3 ||
    new Set(paths).size !== 3 ||
    !['preview', 'signin', 'suggest'].every((name) =>
      paths.some((p) => p.startsWith(`/js/preview/${name}.`)),
    )
  ) {
    throw new Error(
      'Preview CDN preflight failed: expected pinned overlay, signin and suggest paths in src/boot/release.ts.',
    )
  }
  return paths.map((p) => `https://zap.eel.software${p}`)
}
