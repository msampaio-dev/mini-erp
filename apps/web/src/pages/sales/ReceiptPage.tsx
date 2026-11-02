import { useEffect, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { formatCents, PAYMENT_METHODS } from '@mini-erp/contracts'
import { formatQuantity } from '../../lib/quantity.ts'
import { useSale } from '../../lib/sales-queries.ts'
import { useStoreSettings } from '../../lib/store-queries.ts'

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Cupom para impressora térmica de 80 mm (ADR 0020), pela impressão do próprio navegador:
 * sem driver especial nem programa instalado. "Sem valor fiscal" até existir NFC-e.
 * `?imprimir=1` abre a janela de impressão assim que o cupom carrega (atalho do PDV).
 */
export function ReceiptPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const sale = useSale(id)
  const store = useStoreSettings()
  const printed = useRef(false)
  const ready = sale.isSuccess && store.isSuccess

  useEffect(() => {
    if (ready && params.get('imprimir') === '1' && !printed.current) {
      printed.current = true // o StrictMode roda o efeito duas vezes em dev: imprime uma só
      window.print()
    }
  }, [ready, params])

  if (sale.isError) return <p className="error">Venda não encontrada</p>
  if (!ready) return <p className="muted">Carregando…</p>
  const s = sale.data
  const refunded = s.returns.reduce((a, r) => a + r.refundCents, 0)

  return (
    <>
      {/* Só enquanto esta tela existe: 80 × 297 mm é a "bobina" dos drivers de impressora
          térmica, que cortam o papel no fim do conteúdo. ("80mm auto" é CSS inválido.) */}
      <style>{'@page { size: 80mm 297mm; margin: 0; }'}</style>
      <div className="actions no-print">
        <Link to={`/vendas/${s.id}`} className="button secondary">
          Voltar
        </Link>
        <button type="button" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>
      <article className="cupom" aria-label={`Cupom da venda nº ${s.number}`}>
        <header>
          <strong>{store.data.name}</strong>
          {store.data.document && <div>CNPJ {store.data.document}</div>}
          {store.data.address && <div>{store.data.address}</div>}
        </header>
        <p className="cupom-center">
          <strong>DOCUMENTO SEM VALOR FISCAL</strong>
        </p>
        <p>
          Venda nº {s.number} · {dateTime.format(new Date(s.createdAt))}
          <br />
          Operador: {s.createdBy.name}
        </p>
        {s.status === 'CANCELED' && <p className="cupom-center">*** VENDA CANCELADA ***</p>}
        <table>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.productId}>
                <td>
                  {i.name}
                  <br />
                  {formatQuantity(i.quantity)} {i.unit} × {formatCents(i.unitPriceCents)}
                </td>
                <td className="num">{formatCents(i.grossCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl>
          <dt>Subtotal</dt>
          <dd>{formatCents(s.subtotalCents)}</dd>
          {s.discountCents > 0 && (
            <>
              <dt>Desconto</dt>
              <dd>− {formatCents(s.discountCents)}</dd>
            </>
          )}
          <dt className="cupom-total">TOTAL</dt>
          <dd className="cupom-total">{formatCents(s.totalCents)}</dd>
          {s.payments.map((p) => (
            <div key={p.method} className="totals-row">
              <dt>{PAYMENT_METHODS[p.method]}</dt>
              <dd>{formatCents(p.amountCents)}</dd>
            </div>
          ))}
          {s.changeCents > 0 && (
            <>
              <dt>Troco</dt>
              <dd>{formatCents(s.changeCents)}</dd>
            </>
          )}
          {refunded > 0 && (
            <>
              <dt>Devolvido</dt>
              <dd>− {formatCents(refunded)}</dd>
            </>
          )}
        </dl>
        <p className="cupom-center">Obrigado pela preferência!</p>
      </article>
    </>
  )
}
