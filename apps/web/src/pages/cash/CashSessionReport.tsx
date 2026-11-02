import { CASH_MOVEMENT_TYPES, formatCents, PAYMENT_METHODS, type CashSession } from '@mini-erp/contracts'

const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' })

/** Resultado de um caixa: esperado × contado, vendas por forma de pagamento e o livro do caixa. */
export function CashSessionReport({ session }: { session: CashSession }) {
  const totals = session.totals
  if (!totals) return null
  const diff = session.differenceCents

  return (
    <>
      <dl className="totals">
        <dt>Esperado em dinheiro</dt>
        <dd>{formatCents(totals.expectedCents)}</dd>
        {session.countedCents !== null && (
          <>
            <dt>Contado</dt>
            <dd>{formatCents(session.countedCents)}</dd>
            <dt className="grand">{diff! === 0 ? 'Diferença' : diff! > 0 ? 'Sobra' : 'Falta'}</dt>
            <dd className={`grand ${diff! < 0 ? 'down' : ''}`}>{formatCents(Math.abs(diff!))}</dd>
          </>
        )}
      </dl>

      <h2>Vendas por forma de pagamento</h2>
      {totals.byMethod.length === 0 ? (
        <p className="muted">Nenhuma venda concluída neste caixa.</p>
      ) : (
        <dl className="totals">
          {totals.byMethod.map((m) => (
            <div key={m.method} className="totals-row">
              <dt>{PAYMENT_METHODS[m.method]}</dt>
              <dd>{formatCents(m.amountCents)}</dd>
            </div>
          ))}
        </dl>
      )}

      <h2>Movimentações do dinheiro</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Tipo</th>
              <th>Detalhe</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {totals.movements.map((m) => (
              <tr key={m.id}>
                <td>{time.format(new Date(m.createdAt))}</td>
                <td>{CASH_MOVEMENT_TYPES[m.type]}</td>
                <td>
                  {m.saleNumber !== null ? `Venda nº ${m.saleNumber}` : m.note}
                  {m.createdBy.id !== session.operator.id && <span className="muted"> · por {m.createdBy.name}</span>}
                </td>
                <td className={`num ${m.amountCents < 0 ? 'down' : ''}`}>{formatCents(m.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
