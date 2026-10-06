import type { IdempotencyOptions } from '../types/common'
import type { DeleteOptions } from '../types/common'
import { newIdempotencyKey } from '../utils'
import type { CreateFieldInput, UpdateFieldInput } from '../types/collections'

export function normalizeFieldInput<T extends CreateFieldInput | UpdateFieldInput>(input: T): T {
  if (input.label || !input.name) {
    return input
  }

  return {
    ...input,
    label: input.name,
  }
}

export function toDeleteBody(options?: DeleteOptions): DeleteOptions | undefined {
  if (!options?.deleteMediaIds || options.deleteMediaIds.length === 0) {
    return undefined
  }

  return {
    deleteMediaIds: options.deleteMediaIds,
  }
}

/**
 * The `Idempotency-Key` header of a write the API deduplicates: the caller's
 * key, or a fresh one. Suite bearers are refused without it.
 */
export function idempotent(options?: IdempotencyOptions): { headers: Record<string, string> } {
  return { headers: { 'Idempotency-Key': options?.idempotencyKey ?? newIdempotencyKey() } }
}
