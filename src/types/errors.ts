/**
 * API error codes documented by the delivery API.
 */
export type EelZapErrorCode =
  | 'UNAUTHORIZED'
  | 'KEY_EXPIRED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'DRAFT_ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'INVALID_FILTER'
  | 'INVALID_SORT'
  | 'INVALID_LOCALE'
  | 'INVALID_PARAMS'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | (string & {})
