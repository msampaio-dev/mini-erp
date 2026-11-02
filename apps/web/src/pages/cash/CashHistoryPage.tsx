import { useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { formatCents, parseBrlToCents, type CashSession } from '@mini-erp/contracts'
import { useCashSession, useCashSessions, useCloseCash } from '../../lib/cash-queries.ts'
import { CashSessionReport } from './CashSessionReport.tsx'

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
type Status = 'OPEN' | 'CLOSED' | 'ALL'
const STATUS_LABEL: Record<Status, string> = { ALL: 'Todos', OPEN: 'Abertos', CLOSED: 'Fechados' }

/** Visão do gerente: todos os caixas, com esperado e diferença. */
export function CashHistoryPage() {
  const [params, setParams] = useSearchParams()
  const status = (['OPEN', 'CLOSED'].includes(params.get('status') ?? '') ? params.get('status') : 'ALL') as Status
  const page = Math.max(1, Number(params.get('page')) || 1)
  const { data, isPending, isError, error } = useCashSessions(status, page)
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <section>
      <p className="muted breadcrumb">
        <Link to="/caixa">Meu caixa</Link> / Todos os caixas
      </p>
      <h1>Caixas</h1>
      <div className="filters">
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <button
            key={s}
            type="button"
            className={s === status ? undefined : 'secondary'}
            aria-pressed={s === status}
            onClick={() => setParams(s === 'ALL' ? {} : { status: s })}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {isPending ? (
        <p className="muted">Carregando…</p>
      ) : isError ? (
        <p className="error">{error.message}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nº</th>
                <th>Operador</th>
                <th>Abertura</th>
                <th>Fechamento</th>
                <th className="num">Vendas</th>
                <th className="num">Esperado</th>
                <th className="num">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/caixa/${s.id}`}>{s.number}</Link>
                  </td>
                  <td>{s.operator.name}</td>
                  <td>{dateTime.format(new Date(s.openedAt))}</td>
                  <td>{s.closedAt ? dateTime.format(new Date(s.closedAt)) : <span className="badge badge-ok">Aberto</span>}</td>
                  <td className="num">{s.salesCount}</td>
                  <td className="num">{s.expectedCents !== null ? formatCents(s.expectedCents) : '—'}</td>
                  <td className={`num ${(s.differenceCents ?? 0) < 0 ? 'down' : ''}`}>
                    {s.differenceCents !== null ? formatCents(s.differenceCents) : '—'}
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted center">
                    Nenhum caixa.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {totalPages > 1 && (
        <div className="pagination">
          <button type="button" className="secondary" disabled={page <= 1} onClick={() => setParams({ ...(status !== 'ALL' && { status }), page: String(page - 1) })}>
            Anterior
          </button>
          <span className="muted">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={page >= totalPages}
            onClick={() => setParams({ ...(status !== 'ALL' && { status }), page: String(page + 1) })}
          >
            Próxima
          </button>
        </div>
      )}
    </section>
  )
}

export function CashDetailPage() {
  const { id = '' } = useParams()
  const session = useCashSession(id)

  if (session.isPending) return <p className="muted">Carregando…</p>
  if (session.isError) {
    return (
      <section className="empty">
        <h1>Caixa não encontrado</h1>
        <Link to="/caixa">Voltar</Link>
      </section>
    )
  }
  const s = session.data
  return (
    <section className="narrow-wide">
      <p className="muted breadcrumb">
        <Link to="/caixa/historico">Caixas</Link> / Nº {s.number}
      </p>
      <h1>
        Caixa nº {s.number} · {s.operator.name}
      </h1>
      <p className="muted">
        Aberto em {dateTime.format(new Date(s.openedAt))} com {formatCents(s.openingCents)}
        {s.closedAt && ` · fechado em ${dateTime.format(new Date(s.closedAt))} por ${s.closedBy?.name}`}
        {s.closingNote && ` · “${s.closingNote}”`}
      </p>
      <CashSessionReport session={s} />
      {!s.closedAt && <ManagerClose session={s} />}
    </section>
  )
}

/** O operador foi embora sem fechar: o gerente conta a gaveta e fecha por ele. */
function ManagerClose({ session }: { session: CashSession }) {
  const close = useCloseCash(session.id)
  const [counted, setCounted] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const countedCents = parseBrlToCents(counted)
    if (countedCents === null) {
      setError('Informe o dinheiro contado')
      return
    }
    try {
      await close.mutateAsync({ countedCents, note: 'Fechado pelo gerente' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Fechar este caixa</h2>
      <label>
        Dinheiro contado (R$)
        <input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={close.isPending}>
        Fechar caixa de {session.operator.name}
      </button>
    </form>
  )
}
