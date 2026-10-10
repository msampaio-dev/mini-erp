import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IDEMPOTENCY_HEADER,
  salePageSchema,
  saleSchema,
  type CancelSaleInput,
  type CreateSaleInput,
  type SaleStatus,
} from '@mini-erp/contracts'
import { apiGet, apiPost, ApiError, toQueryString } from './api.ts'
import { inventoryKeys } from './inventory-queries.ts'

export interface SaleListParams {
  status: SaleStatus | 'ALL'
  number?: number
  page: number
}

export const saleKeys = {
  all: ['sales'] as const,
  list: (p: SaleListParams) => ['sales', 'list', p] as const,
  detail: (id: string) => ['sales', 'detail', id] as const,
}

export function useSales(params: SaleListParams) {
  return useQuery({
    queryKey: saleKeys.list(params),
    queryFn: () => apiGet(`/sales${toQueryString({ ...params, pageSize: 20 })}`, salePageSchema),
    placeholderData: keepPreviousData,
  })
}

export function useSale(id: string) {
  return useQuery({ queryKey: saleKeys.detail(id), queryFn: () => apiGet(`/sales/${id}`, saleSchema) })
}

/** Venda e cancelamento mexem no estoque: invalida vendas E estoque. */
function useInvalidateAfterSale() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: saleKeys.all }),
      qc.invalidateQueries({ queryKey: inventoryKeys.all }),
    ])
}

export function useCreateSale() {
  const invalidate = useInvalidateAfterSale()
  return useMutation({
    mutationFn: async ({ input, key }: { input: CreateSaleInput; key: string }) => {
      const res = await fetch('/api/sales', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
        body: JSON.stringify(input),
      })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) throw new ApiError(res.status, data)
      return saleSchema.parse(data)
    },
    onSuccess: invalidate,
  })
}

export function useCancelSale(id: string) {
  const invalidate = useInvalidateAfterSale()
  return useMutation({
    mutationFn: (input: CancelSaleInput) => apiPost(`/sales/${id}/cancel`, input, saleSchema),
    onSuccess: invalidate,
  })
}
