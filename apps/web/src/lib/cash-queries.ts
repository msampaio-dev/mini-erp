import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  cashMovementSchema,
  cashSessionPageSchema,
  cashSessionSchema,
  type CashMovementInput,
  type CloseCashInput,
  type OpenCashInput,
} from '@mini-erp/contracts'
import { apiGet, apiPost, apiPostIdempotent, toQueryString } from './api.ts'

export const cashKeys = {
  all: ['cash'] as const,
  current: ['cash', 'current'] as const,
  list: (status: string, page: number) => ['cash', 'list', status, page] as const,
  detail: (id: string) => ['cash', 'detail', id] as const,
}

const currentSchema = z.object({ session: cashSessionSchema.nullable() })

/** O caixa aberto de quem está logado (ou null). */
export function useCurrentCash(enabled = true) {
  return useQuery({
    queryKey: cashKeys.current,
    queryFn: async () => (await apiGet('/cash/current', currentSchema)).session,
    enabled,
  })
}

export function useCashSessions(status: 'OPEN' | 'CLOSED' | 'ALL', page: number) {
  return useQuery({
    queryKey: cashKeys.list(status, page),
    queryFn: () => apiGet(`/cash/sessions${toQueryString({ status, page, pageSize: 20 })}`, cashSessionPageSchema),
    placeholderData: keepPreviousData,
  })
}

export function useCashSession(id: string) {
  return useQuery({ queryKey: cashKeys.detail(id), queryFn: () => apiGet(`/cash/sessions/${id}`, cashSessionSchema) })
}

function useInvalidateCash() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: cashKeys.all })
}

export function useOpenCash() {
  const invalidate = useInvalidateCash()
  return useMutation({
    mutationFn: (input: OpenCashInput) => apiPost('/cash/open', input, cashSessionSchema),
    onSuccess: invalidate,
  })
}

export function useCashMovement() {
  const invalidate = useInvalidateCash()
  return useMutation({
    mutationFn: ({ input, key }: { input: CashMovementInput; key: string }) =>
      apiPostIdempotent('/cash/current/movements', input, key, cashMovementSchema),
    onSuccess: invalidate,
  })
}

/** Fecha o próprio caixa, ou (gerente) o caixa de outra pessoa. */
export function useCloseCash(sessionId?: string) {
  const invalidate = useInvalidateCash()
  return useMutation({
    mutationFn: (input: CloseCashInput) =>
      apiPost(sessionId ? `/cash/sessions/${sessionId}/close` : '/cash/current/close', input, cashSessionSchema),
    onSuccess: invalidate,
  })
}
