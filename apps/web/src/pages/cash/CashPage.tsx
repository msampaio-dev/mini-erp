import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { formatCents, parseBrlToCents, type CashSession } from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { useCashMovement, useCloseCash, useCurrentCash, useOpenCash } from '../../lib/cash-queries.ts'
import { useIdempotencyKey } from '../../lib/use-idempotency-key.ts'
import { CashSessionReport } from './CashSessionReport.tsx'

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** O caixa de quem está logado: abrir, suprimento, sangria e fechamento cego (ADR 0018). */
export function CashPage() {
  const { can } = useAuth()
  const current = useCurrentCash()
  const [closed, setClosed] = useState<CashSession | null>(null)

  return (
    <section className="narrow-wide">
      <div className="row">
        <h1>Meu caixa</h1>
        {can('caixa:gerenciar') && (
          <Link to="/caixa/historico" className="button secondary">
            Todos os caixas
          </Link>
        )}
      </div>

      {closed ? (
        <ClosedResult session={closed} onDismiss={() => setClosed(null)} />
      ) : current.isPending ? (
        <p className="muted">Carregando…</p>
      ) : current.isError ? (
        <p className="error">{current.error.message}</p>
      ) : current.data ? (
        <OpenCash session={current.data} onClosed={setClosed} />
      ) : (
        <OpenForm />
      )}
    </section>
  )
}

function OpenForm() {
  const open = useOpenCash()
  const [opening, setOpening] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const openingCents = opening.trim() === '' ? 0 : parseBrlToCents(opening)
    if (openingCents === null) {
      setError('Valor inválido')
      return
    }
    try {
      await open.mutateAsync({ openingCents, note: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Abrir caixa</h2>
      <p className="muted">Toda venda pertence a um caixa aberto. Conte o troco que está na gaveta.</p>
      <label>
        Troco inicial (R$)
        <input autoFocus inputMode="decimal" placeholder="0,00" value={opening} onChange={(e) => setOpening(e.target.value)} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={open.isPending}>
        {open.isPending ? 'Abrindo…' : 'Abrir caixa'}
      </button>
    </form>
  )
}

function OpenCash({ session, onClosed }: { session: CashSession; onClosed: (s: CashSession) => void }) {
  return (
    <>
      <p className="muted">
        Caixa nº {session.number} aberto em {dateTime.format(new Date(session.openedAt))} com{' '}
        {formatCents(session.openingCents)} de troco · {session.salesCount} venda(s)
      </p>
      <p>
        <Link to="/vendas/nova" className="button">
          Ir para o PDV
        </Link>
      </p>
      {/* Gerente vê o esperado com o caixa aberto; o operador, não (fechamento cego, D46). */}
      {session.totals && <CashSessionReport session={session} />}
      <div className="grid-2">
        <MovementForm />
        <CloseForm onClosed={onClosed} />
      </div>
    </>
  )
}

function MovementForm() {
  const move = useCashMovement()
  const [key, renewKey] = useIdempotencyKey()
  const [type, setType] = useState<'SUPPLY' | 'WITHDRAWAL'>('WITHDRAWAL')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const amountCents = parseBrlToCents(amount)
    if (!amountCents) {
      setMessage({ ok: false, text: 'Informe um valor maior que zero' })
      return
    }
    try {
      const m = await move.mutateAsync({ input: { type, amountCents, note }, key })
      renewKey()
      setAmount('')
      setNote('')
      setMessage({ ok: true, text: `${type === 'SUPPLY' ? 'Suprimento' : 'Sangria'} de ${formatCents(Math.abs(m.amountCents))} registrado.` })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Erro inesperado' })
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Sangria ou suprimento</h2>
      <label>
        Tipo
        <select value={type} onChange={(e) => setType(e.target.value as 'SUPPLY' | 'WITHDRAWAL')}>
          <option value="WITHDRAWAL">Sangria (retirar dinheiro)</option>
          <option value="SUPPLY">Suprimento (colocar troco)</option>
        </select>
      </label>
      <label>
        Valor (R$)
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>
        Motivo
        <input value={note} placeholder="Ex.: depósito no cofre" onChange={(e) => setNote(e.target.value)} />
      </label>
      {message && (
        <p className={message.ok ? 'up' : 'error'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <button type="submit" disabled={move.isPending}>
        Registrar
      </button>
    </form>
  )
}

function CloseForm({ onClosed }: { onClosed: (s: CashSession) => void }) {
  const close = useCloseCash()
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const countedCents = parseBrlToCents(counted)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (countedCents === null) {
      setError('Informe o dinheiro contado na gaveta (0 se não houver)')
      return
    }
    if (!confirming) {
      setConfirming(true)
      return
    }
    try {
      onClosed(await close.mutateAsync({ countedCents, note }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
      setConfirming(false)
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Fechar caixa</h2>
      <p className="muted">Conte o dinheiro da gaveta. O valor esperado aparece depois do fechamento.</p>
      <label>
        Dinheiro contado (R$)
        <input
          inputMode="decimal"
          value={counted}
          onChange={(e) => {
            setCounted(e.target.value)
            setConfirming(false)
          }}
        />
      </label>
      <label>
        Observação
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {confirming && countedCents !== null && (
        <p className="banner">Confirma o fechamento com {formatCents(countedCents)} contados? Não dá para reabrir.</p>
      )}
      <button type="submit" disabled={close.isPending}>
        {confirming ? 'Confirmar fechamento' : 'Fechar caixa'}
      </button>
    </form>
  )
}

function ClosedResult({ session, onDismiss }: { session: CashSession; onDismiss: () => void }) {
  return (
    <>
      <p className="banner">Caixa nº {session.number} fechado.</p>
      <CashSessionReport session={session} />
      <p>
        <button type="button" onClick={onDismiss}>
          Abrir novo caixa
        </button>
      </p>
    </>
  )
}
