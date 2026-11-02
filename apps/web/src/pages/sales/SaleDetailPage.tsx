import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { cancelSaleSchema, formatCents, PAYMENT_METHODS, type Sale } from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { useCancelSale, useSale } from '../../lib/sales-queries.ts'
import { formatQuantity } from '../../lib/quantity.ts'
import { SaleStatusBadge } from './SaleStatusBadge.tsx'

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function SaleDetailPage() {
  const { id = '' } = useParams()
  const sale = useSale(id)

  if (sale.isPending) return <p className="muted">Carregando…</p>
  if (sale.isError) {
    return (
      <section className="empty">
        <h1>Venda não encontrada</h1>
        <Link to="/vendas">Voltar para vendas</Link>
      </section>
    )
  }
  return <SaleDetail sale={sale.data} />
}

function SaleDetail({ sale }: { sale: Sale }) {
  const { can } = useAuth()
  const [canceling, setCanceling] = useState(false)

  return (
    <section className="narrow-wide">
      <p className="muted breadcrumb">
        <Link to="/vendas">Vendas</Link> / Nº {sale.number}
      </p>
      <div className="row">
        <h1>Venda nº {sale.number}</h1>
        <div className="actions">
          <SaleStatusBadge status={sale.status} />
          {can('vendas:cancelar') && sale.status === 'COMPLETED' && !canceling && (
            <button type="button" className="secondary small" onClick={() => setCanceling(true)}>
              Cancelar venda
            </button>
          )}
        </div>
      </div>
      <p className="muted">
        {dateTime.format(new Date(sale.createdAt))} · {sale.createdBy.name}
      </p>

      {sale.status === 'CANCELED' && (
        <p className="banner">
          Cancelada em {dateTime.format(new Date(sale.canceledAt!))} por {sale.canceledBy?.name}: “{sale.cancelReason}”.
          O estoque dos itens foi devolvido.
        </p>
      )}
      {canceling && <CancelForm sale={sale} onDone={() => setCanceling(false)} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Qtd.</th>
              <th className="num">Preço</th>
              <th className="num">Bruto</th>
              <th className="num">Desconto</th>
              <th className="num">Líquido</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((i) => (
              <tr key={i.productId}>
                <td>
                  <Link to={`/produtos/${i.productId}`}>{i.name}</Link> <span className="muted mono">{i.sku}</span>
                </td>
                <td className="num">
                  {formatQuantity(i.quantity)} {i.unit}
                </td>
                <td className="num">{formatCents(i.unitPriceCents)}</td>
                <td className="num">{formatCents(i.grossCents)}</td>
                <td className="num">{i.discountCents ? `− ${formatCents(i.discountCents)}` : '—'}</td>
                <td className="num">{formatCents(i.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="totals totals-right">
        <dt>Subtotal</dt>
        <dd>{formatCents(sale.subtotalCents)}</dd>
        <dt>Desconto</dt>
        <dd>− {formatCents(sale.discountCents)}</dd>
        <dt className="grand">Total</dt>
        <dd className="grand">{formatCents(sale.totalCents)}</dd>
        {sale.payments.map((p) => (
          <div key={p.method} className="totals-row">
            <dt>{PAYMENT_METHODS[p.method]}</dt>
            <dd>{formatCents(p.amountCents)}</dd>
          </div>
        ))}
        {sale.changeCents > 0 && (
          <>
            <dt>Troco</dt>
            <dd>{formatCents(sale.changeCents)}</dd>
          </>
        )}
      </dl>
    </section>
  )
}

function CancelForm({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const cancel = useCancelSale(sale.id)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const parsed = cancelSaleSchema.safeParse({ reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Inválido')
      return
    }
    try {
      await cancel.mutateAsync(parsed.data)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Cancelar venda nº {sale.number}</h2>
      <p className="muted">
        A venda continua no histórico como cancelada e todos os itens voltam ao estoque. Esta ação não pode ser
        desfeita.
      </p>
      <label>
        Motivo
        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="secondary" onClick={onDone}>
          Voltar
        </button>
        <button type="submit" disabled={cancel.isPending}>
          {cancel.isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
        </button>
      </div>
    </form>
  )
}
