import { PAYMENT_METHODS, type SalePayment } from '@mini-erp/contracts'

/** "Dinheiro + Pix": como a venda foi paga, numa linha. */
export function describePayments(payments: SalePayment[]): string {
  return payments.map((p) => PAYMENT_METHODS[p.method]).join(' + ') || '—'
}
