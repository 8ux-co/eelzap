/**
 * Retries of a refused request: `429 Too Many Requests` always, and `503
 * Service Unavailable` when it says when to come back (`Retry-After`).
 *
 * Only a request that is safe to repeat is retried: a read (`GET`, `HEAD`), or
 * a write that carries an `Idempotency-Key`, which the API deduplicates. Any
 * other write is never repeated, so a create can never land twice.
 */
export interface RetryOptions {
  /** Retries after the first attempt. Default `3`; `0` turns retrying off. */
  retries?: number
  /**
   * The longest single wait, in ms. Default `60000`, the API's rate window. A
   * `Retry-After` longer than this is not waited out: the refusal is thrown.
   */
  maxDelayMs?: number
  /** The first backoff step when the answer has no `Retry-After`, in ms. Default `500`. */
  baseDelayMs?: number
  /** Called before each wait, for logging. */
  onRetry?: (event: RetryEvent) => void
}

/** What {@link RetryOptions.onRetry} is told before a wait. */
export interface RetryEvent {
  /** The retry about to happen: `1` for the first. */
  attempt: number
  /** How long the client waits first, in ms. */
  delayMs: number
  /** The refused answer's status: `429` or `503`. */
  status: number
  method: string
  url: string
}

/** @internal */
export type ResolvedRetry = Required<Omit<RetryOptions, 'onRetry'>> & Pick<RetryOptions, 'onRetry'>

/** @internal */
export function resolveRetry(retry: boolean | RetryOptions | undefined): ResolvedRetry | null {
  if (retry === false) return null
  const options = retry === true || retry === undefined ? {} : retry
  const resolved = {
    retries: options.retries ?? 3,
    maxDelayMs: options.maxDelayMs ?? 60_000,
    baseDelayMs: options.baseDelayMs ?? 500,
    onRetry: options.onRetry,
  }
  return resolved.retries > 0 ? resolved : null
}

/**
 * Whether the request may be sent again: a read, or a write the API
 * deduplicates by `Idempotency-Key` whose body can be sent twice.
 *
 * @internal
 */
export function isRepeatable(method: string, headers: Headers, body: unknown): boolean {
  if (method === 'GET' || method === 'HEAD') return true
  return headers.has('Idempotency-Key') && (body == null || typeof body === 'string')
}

/**
 * `Retry-After` in ms: delay-seconds or an HTTP-date. `null` when absent or
 * unreadable.
 *
 * @internal
 */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? null : Math.max(0, date - now)
}

/**
 * How long to wait before retry number `attempt` (from 1), or `null` to give
 * up and surface the answer.
 *
 * With `Retry-After`, that long plus up to a second of jitter, so clients
 * refused together do not come back together. Without it, a `429` backs off
 * exponentially from `baseDelayMs`, half fixed and half jitter; a `503` without
 * it is not retried, since nothing says the outage is brief.
 *
 * @internal
 */
export function retryDelay(
  response: Response,
  attempt: number,
  options: ResolvedRetry,
  now: number = Date.now(),
  random: () => number = Math.random,
): number | null {
  if (attempt > options.retries) return null
  if (response.status !== 429 && response.status !== 503) return null

  const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), now)
  if (retryAfter !== null) {
    if (retryAfter > options.maxDelayMs) return null
    return Math.min(options.maxDelayMs, retryAfter + Math.floor(random() * 1000))
  }
  if (response.status === 503) return null

  const step = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1))
  return Math.floor(step / 2 + random() * (step / 2))
}
