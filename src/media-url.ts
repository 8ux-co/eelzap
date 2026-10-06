import type { MediaValue } from './types/common'

/**
 * The URL to render a media value with: the public `url` of a published file,
 * else the short-lived `signedUrl` a draft carries when the key may read
 * drafts. `null` when there is neither — an unpublished file read with a key
 * that cannot see drafts (`mediaAccess: 'none'`), or no media at all.
 *
 * A signed URL expires (`signedUrlExpiresAt`), so never cache it in a page
 * that outlives that time.
 */
export function getMediaUrl(
  media: Pick<MediaValue, 'url' | 'signedUrl'> | null | undefined,
): string | null {
  return media?.url ?? media?.signedUrl ?? null
}
