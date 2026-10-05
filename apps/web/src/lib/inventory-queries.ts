import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  balanceSchema,
  IDEMPOTENCY_HEADER,
  movementPageSchema,
  movementSchema,
  type CreateAdjustmentInput,
  type CreateEntryInput,
  type ReverseMovementInput,
} from '@mini-erp/contracts'
import { z } from 'zod'
import { apiGet, ApiError, toQueryString } from './api.ts'

export const inventoryKeys = {
  all: ['inventory'] as const,
  balances: (ids: string[]) => ['inventory', 'balances', [...ids].sort()] as const,
  movements: (productId: string, page: number) => ['inventory', 'movements', productId, page] as const,
}

export function useBalances(productIds: string[], enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.balances(productIds),
    queryFn: () =>
      apiGet(`/inventory/balances${toQueryString({ productIds: productIds.join(',') })}`, z.array(balanceSchema)),
    enabled: enabled && productIds.length > 0,
    placeholderData: keepPreviousData,
  })
}

export function useMovements(productId: string, page: number) {
  return useQuery({
    queryKey: inventoryKeys.movements(productId, page),
    queryFn: () => apiGet(`/inventory/movements${toQueryString({ productId, page, pageSize: 20 })}`, movementPageSchema),
    placeholderData: keepPreviousData,
  })
}

/**
 * POST com Idempotency-Key. A chave é gerada pelo FORMULÁRIO (uma por operação) e
 * reaproveitada se o usuário reenviar: um clique duplo ou um retry após falha de rede
 * nunca lança a mesma movimentação duas vezes (ADR 0010).
 */
async function postIdempotent(path: string, body: unknown, key: string) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
    body: JSON.stringify(body),
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return movementSchema.parse(data)
}

/** Qualquer movimentação muda saldo e kardex: invalida tudo de estoque de uma vez. */
function useInventoryMutation<T>(fn: (vars: T) => Promise<z.output<typeof movementSchema>>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: inventoryKeys.all }),
  })
}

export const useRegisterEntry = () =>
  useInventoryMutation(({ input, key }: { input: CreateEntryInput; key: string }) =>
    postIdempotent('/inventory/entries', input, key),
  )

export const useRegisterAdjustment = () =>
  useInventoryMutation(({ input, key }: { input: CreateAdjustmentInput; key: string }) =>
    postIdempotent('/inventory/adjustments', input, key),
  )

export const useReverseMovement = () =>
  useInventoryMutation(({ movementId, input, key }: { movementId: string; input: ReverseMovementInput; key: string }) =>
    postIdempotent(`/inventory/movements/${movementId}/reverse`, input, key),
  )
