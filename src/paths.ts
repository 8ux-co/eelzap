function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

/**
 * Joins resource path segments without applying any API prefix.
 *
 * @internal
 */
export function buildResourcePath(...segments: string[]): string {
  const normalized = segments.map(trimSlashes).filter((segment) => segment.length > 0)
  return `/${normalized.join('/')}`
}

/**
 * Normalizes an SDK path prefix for URL joining.
 *
 * @internal
 */
export function normalizePathPrefix(pathPrefix: string): string {
  const trimmed = trimSlashes(pathPrefix)
  return trimmed.length > 0 ? `${trimmed}/` : ''
}
