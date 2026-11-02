import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supplierPageSchema, supplierSchema, type SupplierInput } from '@mini-erp/contracts'
import { apiGet, apiPost, apiSend, toQueryString } from './api.ts'

export const supplierKeys = {
  all: ['suppliers'] as const,
  list: (q: string, active: string, page: number) => ['suppliers', 'list', q, active, page] as const,
}

export function useSuppliers(q: string, active: 'true' | 'false' | 'all', page: number, enabled = true) {
  return useQuery({
    queryKey: supplierKeys.list(q, active, page),
    queryFn: () => apiGet(`/suppliers${toQueryString({ q, active, page, pageSize: 100 })}`, supplierPageSchema),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useSaveSupplier(id?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SupplierInput) =>
      id ? apiSend('PUT', `/suppliers/${id}`, input, supplierSchema) : apiPost('/suppliers', input, supplierSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplierKeys.all }),
  })
}

export function useSetSupplierActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiPost(`/suppliers/${id}/${active ? 'activate' : 'deactivate'}`, undefined, supplierSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplierKeys.all }),
  })
}
