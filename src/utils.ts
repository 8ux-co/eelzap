import type {
  ClientDefaults,
  CommonRequestOptions,
  PreviewOption,
  QueryPrimitive,
} from './types/common'
import type { ItemFilters } from './types/items'

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

/** A Zap preview token (`zpt_…`), minted for a draft-mode URL. */
export function isPreviewToken(apiKey: string): boolean {
  return apiKey.trim().startsWith('zpt_')
}

/**
 * `preview=1` when asked for, and NO key otherwise, so a request without
 * preview is exactly what it always was. `stega=0` only beside `preview=1`
 * and only when `stega` is exactly `false` (§2.4).
 */
export function previewParam(options: PreviewOption): { preview?: 1; stega?: 0 } {
  return options.preview
    ? options.stega === false
      ? { preview: 1, stega: 0 }
      : { preview: 1 }
    : {}
}

/**
 * Tags a parsed preview response so `cachedFetch` never stores it (§7.5).
 * `Symbol.for`, not a module-level symbol: the mark must survive the ESM/CJS
 * dual-package split, where the client and the cache can be two copies.
 * Non-enumerable, so it never shows in JSON or spreads.
 *
 * @internal
 */
export function markPreview<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.defineProperty(value, Symbol.for('eelzap.preview'), { value: true })
  }
  return value
}

/** Whether a value came from a preview response (see {@link markPreview}). */
export function isPreviewResult(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<symbol, unknown>)[Symbol.for('eelzap.preview')] === true
  )
}

/**
 * A fresh `Idempotency-Key`: `crypto.randomUUID()` where it exists (browsers,
 * edge runtimes, Node 19+), else a time-plus-random key, which is all a key
 * needs to be (unique, not secret).
 *
 * @internal
 */
export function newIdempotencyKey(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function toArrayParam(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined
}

export function mergeRequestOptions<T extends CommonRequestOptions>(
  defaults: ClientDefaults,
  options?: T,
): T {
  return {
    ...defaults,
    ...options,
  } as T
}

export function cleanParams(
  params: Record<string, QueryPrimitive | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => {
      return value === undefined ? [] : [[key, String(value)]]
    }),
  )
}

export function normalizeHeaderValue(value: string | null | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isOperatorMap(
  value: ItemFilters[string],
): value is Exclude<ItemFilters[string], QueryPrimitive> {
  return typeof value === 'object' && !Array.isArray(value)
}

export function serializeFilters(filters?: ItemFilters): Record<string, string> {
  if (!filters) {
    return {}
  }

  return Object.entries(filters).reduce<Record<string, string>>((acc, [field, value]) => {
    if (!isOperatorMap(value)) {
      acc[`filter[${field}]`] = String(value)
      return acc
    }

    for (const [operator, operatorValue] of Object.entries(value)) {
      if (operatorValue === undefined) {
        continue
      }

      const serializedValue = Array.isArray(operatorValue)
        ? operatorValue.join(',')
        : String(operatorValue)
      acc[`filter[${field}][${operator}]`] = serializedValue
    }

    return acc
  }, {})
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '***'
  }

  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
}
