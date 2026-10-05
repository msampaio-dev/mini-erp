import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import {
  ADJUSTMENT_REASONS,
  formatCents,
  MOVEMENT_TYPE_LABELS,
  reverseMovementSchema,
  type Movement,
  type Product,
} from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { useProduct } from '../../lib/catalog-queries.ts'
import { useBalances, useMovements, useReverseMovement } from '../../lib/inventory-queries.ts'
import { formatCostCents, formatQuantity } from '../../lib/quantity.ts'
import { useIdempotencyKey } from '../../lib/use-idempotency-key.ts'
import { AdjustmentForm, EntryForm } from './MovementForms.tsx'

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function StockPage() {
  const { productId = '' } = useParams()
  const product = useProduct(productId)

  if (product.isPending) return <p className="muted">Carregando…</p>
  if (product.isError) {
    return (
      <section className="empty">
        <h1>Produto não encontrado</h1>
        <Link to="/produtos">Voltar para produtos</Link>
      </section>
    )
  }
  return <Stock product={product.data} />
}

function Stock({ product }: { product: Product }) {
  const { can } = useAuth()
  const [open, setOpen] = useState<'entry' | 'adjust' | null>(null)
  const [reversing, setReversing] = useState<Movement | null>(null)
  const [page, setPage] = useState(1)

  const { data: balances } = useBalances([product.id])
  const balance = balances?.[0]
  const movements = useMovements(product.id, page)
  const totalPages = movements.data ? Math.max(1, Math.ceil(movements.data.total / movements.data.pageSize)) : 1
  const belowMin = balance !== undefined && product.minStock > 0 && balance.quantity < product.minStock
  const archived = product.status === 'ARCHIVED'

  return (
    <section>
      <p className="muted breadcrumb">
        <Link to="/produtos">Produtos</Link> / <Link to={`/produtos/${product.id}`}>{product.name}</Link> / Estoque
      </p>
      <div className="row">
        <h1>
          Estoque · {product.name} <span className="muted mono small-text">{product.sku}</span>
        </h1>
        <div className="actions">
          {can('estoque:entrada') && (
            <button type="button" disabled={archived} onClick={() => setOpen('entry')}>
              Registrar entrada
            </button>
          )}
          {can('estoque:ajustar') && (
            <button type="button" className="secondary" disabled={archived} onClick={() => setOpen('adjust')}>
              Ajustar
            </button>
          )}
        </div>
      </div>
      {archived && <p className="banner">Produto arquivado: novas movimentações estão bloqueadas.</p>}

      <div className="stats">
        <Stat label="Saldo atual" value={balance ? `${formatQuantity(balance.quantity)} ${product.unit}` : '—'} alert={belowMin} />
        <Stat label="Estoque mínimo" value={`${formatQuantity(product.minStock)} ${product.unit}`} />
        <Stat label="Custo médio" value={balance ? formatCostCents(balance.avgCostCents) : '—'} />
        <Stat label="Valor em estoque" value={balance ? formatCents(balance.totalValueCents) : '—'} />
      </div>
      {belowMin && <p className="error">Saldo abaixo do mínimo: hora de repor.</p>}

      {open === 'entry' && <EntryForm product={product} onDone={() => setOpen(null)} />}
      {open === 'adjust' && <AdjustmentForm product={product} onDone={() => setOpen(null)} />}
      {reversing && <ReverseForm movement={reversing} unit={product.unit} onDone={() => setReversing(null)} />}

      <h2>Movimentações</h2>
      {movements.isError && <p className="error">Não foi possível carregar: {movements.error.message}</p>}
      {movements.data && (
        <>
          <div className={`table-wrap${movements.isPlaceholderData ? ' loading' : ''}`}>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th className="num">Qtd.</th>
                  <th className="num">Custo unit.</th>
                  <th className="num">Saldo</th>
                  <th>Usuário</th>
                  <th>Observação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {movements.data.items.map((m) => (
                  <tr key={m.id} className={m.reversedById ? 'reversed' : undefined}>
                    <td>{dateTime.format(new Date(m.createdAt))}</td>
                    <td>
                      {MOVEMENT_TYPE_LABELS[m.type]}
                      {m.reason && <span className="muted"> · {ADJUSTMENT_REASONS[m.reason]}</span>}
                      {m.reversedById && <span className="badge badge-off">estornada</span>}
                    </td>
                    <td className={`num ${m.quantity > 0 ? 'up' : 'down'}`}>{formatQuantity(m.quantity, { signed: true })}</td>
                    <td className="num">{m.unitCostCents === null ? '—' : formatCents(m.unitCostCents)}</td>
                    <td className="num">{formatQuantity(m.balanceAfter)}</td>
                    <td>{m.createdBy.name}</td>
                    <td className="note">{m.note || '—'}</td>
                    <td>
                      {can('estoque:ajustar') && !m.reversedById && (m.type === 'ENTRY' || m.type === 'ADJUSTMENT') && (
                        <button type="button" className="secondary small" onClick={() => setReversing(m)}>
                          Estornar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {movements.data.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted center">
                      Nenhuma movimentação ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <nav className="pagination" aria-label="Paginação">
              <button type="button" className="secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Mais recentes
              </button>
              <span className="muted">
                Página {page} de {totalPages}
              </span>
              <button type="button" className="secondary small" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Mais antigas
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  )
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`stat${alert ? ' stat-alert' : ''}`}>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ReverseForm({ movement, unit, onDone }: { movement: Movement; unit: string; onDone: () => void }) {
  const [key, renewKey] = useIdempotencyKey()
  const reverse = useReverseMovement()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const parsed = reverseMovementSchema.safeParse({ note })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Inválido')
      return
    }
    try {
      await reverse.mutateAsync({ movementId: movement.id, input: parsed.data, key })
      renewKey()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Estornar movimentação</h2>
      <p className="muted">
        {MOVEMENT_TYPE_LABELS[movement.type]} de {formatQuantity(movement.quantity, { signed: true })} {unit} em{' '}
        {dateTime.format(new Date(movement.createdAt))}. O estorno lança a movimentação inversa; a original
        continua no histórico.
      </p>
      <label>
        Motivo do estorno
        <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" disabled={reverse.isPending}>
          {reverse.isPending ? 'Estornando…' : 'Confirmar estorno'}
        </button>
      </div>
    </form>
  )
}
