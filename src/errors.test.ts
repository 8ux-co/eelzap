import { describe, expect, it } from 'vitest'

import { EelZapError, EelZapNetworkError, isEelZapError } from './errors'

describe('errors', () => {
  it('creates API errors with code and status', () => {
    const error = new EelZapError('NOT_FOUND', 'Missing.', 404)

    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('NOT_FOUND')
    expect(error.status).toBe(404)
    expect(error.message).toBe('Missing.')
  })

  it('creates network errors with NETWORK_ERROR code', () => {
    const cause = new Error('boom')
    const error = new EelZapNetworkError(cause)

    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.status).toBe(0)
    expect(error.cause).toBe(cause)
  })

  it('detects SDK errors with a type guard', () => {
    expect(isEelZapError(new EelZapError('INVALID_PARAMS', 'Bad request.', 400))).toBe(true)
    expect(isEelZapError(new Error('plain'))).toBe(false)
  })
})
