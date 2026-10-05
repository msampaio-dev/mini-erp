import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  categorySchema,
  productPageSchema,
  productSchema,
  type CreateCategoryInput,
  type CreateProductInput,
  type ProductStatus,
  type UpdateProductInput,
} from '@mini-erp/contracts'
import { z } from 'zod'
import { apiGet, apiPost, apiSend, toQueryString } from './api.ts'

export interface ProductListParams {
  q?: string
  status: ProductStatus | 'ALL'
  page: number
  pageSize: number
}

/**
 * Chaves hierárquicas do cache: invalidar ['products'] atualiza listas E detalhes de uma vez.
 */
export const catalogKeys = {
  products: ['products'] as const,
  productList: (params: ProductListParams) => ['products', 'list', params] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  categories: ['categories'] as const,
}

export function useProducts(params: ProductListParams) {
  return useQuery({
    queryKey: catalogKeys.productList(params),
    queryFn: () => apiGet(`/products${toQueryString({ ...params })}`, productPageSchema),
    // Mantém a página anterior na tela enquanto a próxima carrega: sem "pisca-pisca".
    placeholderData: keepPreviousData,
  })
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.product(id ?? ''),
    queryFn: () => apiGet(`/products/${id}`, productSchema),
    enabled: id !== undefined,
  })
}

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories,
    queryFn: () => apiGet('/categories', z.array(categorySchema)),
  })
}

/** Depois de qualquer escrita: guarda o produto devolvido e marca as listas como desatualizadas. */
function useOnProductSaved() {
  const qc = useQueryClient()
  return (product: z.output<typeof productSchema>) => {
    qc.setQueryData(catalogKeys.product(product.id), product)
    // Listas na tela recarregam já; as demais, quando forem abertas de novo.
    return qc.invalidateQueries({ queryKey: catalogKeys.products })
  }
}

export function useCreateProduct() {
  const onSaved = useOnProductSaved()
  return useMutation({
    mutationFn: (input: CreateProductInput) => apiPost('/products', input, productSchema),
    onSuccess: onSaved,
  })
}

export function useUpdateProduct(id: string) {
  const onSaved = useOnProductSaved()
  return useMutation({
    mutationFn: (input: UpdateProductInput) => apiSend('PUT', `/products/${id}`, input, productSchema),
    onSuccess: onSaved,
  })
}

export function useSetProductStatus(id: string) {
  const onSaved = useOnProductSaved()
  return useMutation({
    mutationFn: (action: 'archive' | 'unarchive') =>
      apiPost(`/products/${id}/${action}`, undefined, productSchema),
    onSuccess: onSaved,
  })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCategoryInput) => apiPost('/categories', input, categorySchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKeys.categories }),
  })
}
