import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  abcRowSchema,
  inventoryValueSchema,
  marginRowSchema,
  reorderRowSchema,
  salesReportSchema,
  sellerRowSchema,
  staleRowSchema,
  type Granularity,
  type Period,
} from '@mini-erp/contracts'
import { z } from 'zod'
import { apiGet, toQueryString } from './api.ts'

const keys = (name: string, params: object) => ['reports', name, params] as const
const get = <T extends z.ZodType>(path: string, params: Record<string, string | number | undefined>, schema: T) =>
  apiGet(`/reports/${path}${toQueryString(params)}`, schema)

// keepPreviousData: ao trocar o período, os números antigos ficam na tela (esmaecidos) até chegar o novo.
const options = { placeholderData: keepPreviousData } as const

export const useSalesReport = (p: Period, granularity: Granularity) =>
  useQuery({ queryKey: keys('sales', { ...p, granularity }), queryFn: () => get('sales', { ...p, granularity }, salesReportSchema), ...options })

export const useMarginReport = (p: Period, groupBy: 'product' | 'category') =>
  useQuery({ queryKey: keys('margin', { ...p, groupBy }), queryFn: () => get('margin', { ...p, groupBy }, z.array(marginRowSchema)), ...options })

export const useAbcReport = (p: Period) =>
  useQuery({ queryKey: keys('abc', p), queryFn: () => get('abc', { ...p }, z.array(abcRowSchema)), ...options })

export const useSellersReport = (p: Period) =>
  useQuery({ queryKey: keys('sellers', p), queryFn: () => get('sellers', { ...p }, z.array(sellerRowSchema)), ...options })

export const useInventoryValue = () =>
  useQuery({ queryKey: keys('inventory', {}), queryFn: () => get('inventory', {}, inventoryValueSchema) })

export const useReorderReport = () =>
  useQuery({ queryKey: keys('reorder', {}), queryFn: () => get('reorder', {}, z.array(reorderRowSchema)) })

export const useStaleReport = (days: number) =>
  useQuery({ queryKey: keys('stale', { days }), queryFn: () => get('stale', { days }, z.array(staleRowSchema)), ...options })

/** Link de download do CSV: mesma origem, o cookie de sessão vai junto. */
export const csvUrl = (path: string, params: Record<string, string | number | undefined>) =>
  `/api/reports/${path}${toQueryString({ ...params, format: 'csv' })}`
