import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { formatCents, SALE_STATUSES, type SaleStatus } from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { useSales, type SaleListParams } from '../../lib/sales-queries.ts'
import { describePayments } from './payments.ts'
import { SaleStatusBadge } from './SaleStatusBadge.tsx'

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const STATUS_LABEL: Record<SaleStatus | 'ALL', string> = { ALL: 'Todas', COMPLETED: 'Concluídas', CANCELED: 'Canceladas' }

export function SalesListPage() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  const params: SaleListParams = {
    status: SALE_STATUSES.includes(statusParam as SaleStatus) ? (statusParam as SaleStatus) : 'ALL',
    number: Number(searchParams.get('numero')) || undefined,
    page: Math.max(1, Number(searchParams.get('page')) || 1),
  }
  const [numberText, setNumberText] = useState(params.number ? String(params.number) : '')

  function update(changes: Record<string, string>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )
  }

  function onSearch(e: FormEvent) {
    e.preventDefault()
    update({ numero: numberText.replace(/\D/g, ''), page: '' })
  }

  const { data, isPending, isError, error, isPlaceholderData } = useSales(params)
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <section>
      <div className="row">
        <h1>Vendas</h1>
        {can('vendas:criar') && (
          <Link to="/vendas/nova" className="button">
            Nova venda
          </Link>
        )}
      </div>

      <form className="filters" onSubmit={onSearch}>
        <input
          type="search"
          inputMode="numeric"
          placeholder="Número da venda"
          aria-label="Número da venda"
          value={numberText}
          onChange={(e) => setNumberText(e.target.value)}
        />
        <select
          aria-label="Situação"
          value={params.status}
          onChange={(e) => update({ status: e.target.value === 'ALL' ? '' : e.target.value, page: '' })}
        >
          {(['ALL', ...SALE_STATUSES] as const).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </form>

      {isPending && <p className="muted">Carregando…</p>}
      {isError && <p className="error">Não foi possível carregar: {error.message}</p>}
      {data && (
        <>
          <div className={`table-wrap${isPlaceholderData ? ' loading' : ''}`}>
            <table>
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Data</th>
                  <th>Vendedor</th>
                  <th className="num">Itens</th>
                  <th>Pagamento</th>
                  <th className="num">Total</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} className={s.status === 'CANCELED' ? 'reversed' : undefined}>
                    <td>
                      <Link to={`/vendas/${s.id}`}>{s.number}</Link>
                    </td>
                    <td>{dateTime.format(new Date(s.createdAt))}</td>
                    <td>{s.createdBy.name}</td>
                    <td className="num">{s.itemCount}</td>
                    <td>{describePayments(s.payments)}</td>
                    <td className="num">{formatCents(s.totalCents)}</td>
                    <td>
                      <SaleStatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted center">
                      Nenhuma venda encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <nav className="pagination" aria-label="Paginação">
            <button
              type="button"
              className="secondary small"
              disabled={params.page <= 1}
              onClick={() => update({ page: String(params.page - 1) })}
            >
              Anterior
            </button>
            <span className="muted">
              Página {params.page} de {totalPages} · {data.total} venda(s)
            </span>
            <button
              type="button"
              className="secondary small"
              disabled={params.page >= totalPages}
              onClick={() => update({ page: String(params.page + 1) })}
            >
              Próxima
            </button>
          </nav>
        </>
      )}
    </section>
  )
}
