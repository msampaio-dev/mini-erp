import type { Sale } from '@mini-erp/contracts'

/** Quanto de cada item ainda pode voltar (em milésimos, sem erro de float). */
export const remainingOf = (i: Sale['items'][number]) =>
  (Math.round(i.quantity * 1000) - Math.round(i.returnedQuantity * 1000)) / 1000

export const hasReturnable = (sale: Sale) => sale.status === 'COMPLETED' && sale.items.some((i) => remainingOf(i) > 0)
