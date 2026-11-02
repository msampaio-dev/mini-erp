import { useState, type FormEvent } from 'react'
import {
  createReturnSchema,
  formatCents,
  PAYMENT_METHODS,
  returnRefundCents,
  type PaymentMethod,
  type Sale,
  type SaleReturn,
} from '@mini-erp/contracts'
import { formatQuantity, parseQuantity } from '../../lib/quantity.ts'
import { useCreateReturn } from '../../lib/sales-queries.ts'
import { useIdempotencyKey } from '../../lib/use-idempotency-key.ts'
import { remainingOf } from './returns.ts'

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Devolução parcial (ADR 0019): o cliente traz de volta parte do que comprou. */
export function ReturnForm({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const createReturn = useCreateReturn(sale.id)
  const [key] = useIdempotencyKey()
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>(sale.payments[0]?.method ?? 'CASH')
  const [restock, setRestock] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const lines = sale.items
    .map((item) => ({ item, qty: parseQuantity(quantities[item.productId] ?? '') }))
    .filter((l) => l.qty !== null && l.qty > 0)
  // Prévia do reembolso com a MESMA conta da API (o servidor recalcula e é quem vale).
  const preview = lines.reduce((a, { item, qty }) => a + (qty! <= remainingOf(item) ? returnRefundCents(item, qty!) : 0), 0)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = createReturnSchema.safeParse({
      items: lines.map(({ item, qty }) => ({ productId: item.productId, quantity: qty })),
      reason,
      refundMethod,
      restock,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    try {
      await createReturn.mutateAsync({ input: parsed.data, key })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Devolução da venda nº {sale.number}</h2>
      <p className="muted">
        Informe quanto de cada item o cliente trouxe. O reembolso é proporcional ao que ele pagou pelo item, já com o
        desconto da venda.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Pode devolver</th>
              <th className="num">Devolver</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item) => {
              const remaining = remainingOf(item)
              return (
                <tr key={item.productId}>
                  <td>{item.name}</td>
                  <td className="num">
                    {formatQuantity(remaining)} {item.unit}
                  </td>
                  <td className="num">
                    <input
                      className="qty-input"
                      inputMode="decimal"
                      aria-label={`Devolver de ${item.name}`}
                      disabled={remaining <= 0}
                      placeholder="0"
                      value={quantities[item.productId] ?? ''}
                      onChange={(e) => setQuantities((q) => ({ ...q, [item.productId]: e.target.value }))}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <label>
        Motivo
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label>
        Reembolso em
        <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}>
          {Object.entries(PAYMENT_METHODS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        Volta para o estoque (produto em condição de venda)
      </label>
      <p>
        Reembolso: <strong>{formatCents(preview)}</strong>
        {refundMethod === 'CASH' && <span className="muted"> · sai da gaveta do caixa</span>}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="secondary" onClick={onDone}>
          Voltar
        </button>
        <button type="submit" disabled={createReturn.isPending || lines.length === 0}>
          {createReturn.isPending ? 'Registrando…' : 'Confirmar devolução'}
        </button>
      </div>
    </form>
  )
}

export function ReturnsHistory({ returns }: { returns: SaleReturn[] }) {
  if (returns.length === 0) return null
  return (
    <>
      <h2>Devoluções</h2>
      <ul className="plain-list">
        {returns.map((r) => (
          <li key={r.id}>
            <strong>Nº {r.number}</strong> · {dateTime.format(new Date(r.createdAt))} · {r.createdBy.name} ·{' '}
            {formatCents(r.refundCents)} em {PAYMENT_METHODS[r.refundMethod]}
            {!r.restock && ' · não voltou ao estoque'}
            <div className="muted">
              {r.items.map((i) => `${formatQuantity(i.quantity)} ${i.unit} de ${i.name}`).join(', ')} · “{r.reason}”
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
