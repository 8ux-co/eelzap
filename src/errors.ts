import type { ApiErrorDetail } from './types/common'
import type { EelZapErrorCode } from './types/errors'

/**
 * Base error thrown by the SDK for API and transport failures.
 */
export class EelZapError extends Error {
  readonly code: EelZapErrorCode
  readonly status: number
  /** Per-field problems when the API refused the input; empty otherwise. */
  readonly details: readonly ApiErrorDetail[]

  constructor(
    code: EelZapErrorCode,
    message: string,
    status: number,
    details: readonly ApiErrorDetail[] = [],
  ) {
    super(message)
    this.name = 'EelZapError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/**
 * Error thrown when a network failure or timeout prevents a response.
 */
export class EelZapNetworkError extends EelZapError {
  override readonly cause: unknown

  constructor(cause: unknown, message = 'Network request failed.') {
    super('NETWORK_ERROR', message, 0)
    this.name = 'EelZapNetworkError'
    this.cause = cause
  }
}

/**
 * Type guard for SDK errors.
 */
export function isEelZapError(error: unknown): error is EelZapError {
  return error instanceof EelZapError
}
