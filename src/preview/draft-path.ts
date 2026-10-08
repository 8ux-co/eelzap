// eslint-disable-next-line no-control-regex
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f\\]/

/**
 * The path to redirect to, or null when it could leave the site. Returned
 * as path + query + hash, never absolute, so the `Location` stays on the
 * host the browser asked.
 */
export function safeRedirectPath(raw: string | null, requestUrl: string): string | null {
  const value = raw ?? '/'
  if (value.length === 0 || value.length > 2048) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (UNSAFE_PATH_CHARS.test(value)) return null
  let base: URL
  let target: URL
  try {
    base = new URL(requestUrl)
    target = new URL(value, base)
  } catch {
    return null
  }
  if (target.origin !== base.origin) return null
  // Dot segments can collapse into a leading `//` (`/.//evil.example`,
  // `/a/..//evil.example`), and a `Location` of `//evil.example` is
  // protocol-relative: another host. The resolved path must not start so.
  if (target.pathname.startsWith('//')) return null
  // Refuse a token anywhere in the redirect, including percent-encoded ones.
  let decoded = value
  for (let i = 0; i < value.length; i++) {
    if (/zpt_/i.test(decoded)) return null
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    if (next === decoded) break
    decoded = next
  }
  return `${target.pathname}${target.search}${target.hash}`
}
