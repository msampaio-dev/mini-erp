import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import {
  centsToInput,
  computeSaleTotals,
  createSaleSchema,
  formatCents,
  isFractionalUnit,
  parseBrlToCents,
  parseScaleLabel,
  PAYMENT_METHODS,
  productPageSchema,
  scaleQuantity,
  settlePayments,
  type PaymentMethod,
  type Product,
  type Sale,
  type SaleDiscount,
} from '@mini-erp/contracts'
import { apiGet, toQueryString } from '../../lib/api.ts'
import { useCurrentCash } from '../../lib/cash-queries.ts'
import { useStoreSettings } from '../../lib/store-queries.ts'
import { useBalances } from '../../lib/inventory-queries.ts'
import { formatQuantity, parseQuantity } from '../../lib/quantity.ts'
import { useCreateSale } from '../../lib/sales-queries.ts'
import { useIdempotencyKey } from '../../lib/use-idempotency-key.ts'
import { describePayments } from './payments.ts'

interface CartLine {
  product: Product
  quantity: string
}

type DiscountMode = 'NONE' | 'AMOUNT' | 'PERCENT'

interface PaymentLine {
  method: PaymentMethod
  /** Vazio = "o que falta pagar": no caso comum (um meio só) o operador não digita nada. */
  amount: string
}

/** Sem caixa aberto não há venda (D44): o PDV manda abrir o caixa primeiro. */
export function PosPage() {
  const cash = useCurrentCash()
  if (cash.isPending) return <p className="muted">Carregando…</p>
  if (!cash.isError && !cash.data) {
    return (
      <section className="empty">
        <h1>Caixa fechado</h1>
        <p className="muted">Abra o seu caixa, com o troco inicial, antes de vender.</p>
        <Link to="/caixa" className="button">
          Abrir caixa
        </Link>
      </section>
    )
  }
  return <Pos />
}

/** Ponto de venda: busca/leitor de código de barras, carrinho, desconto, pagamento. */
function Pos() {
  const [cart, setCart] = useState<CartLine[]>([])
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Product[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [discountMode, setDiscountMode] = useState<DiscountMode>('NONE')
  const [discountText, setDiscountText] = useState('')
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'PIX', amount: '' }])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Sale | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const [key, renewKey] = useIdempotencyKey()
  const createSale = useCreateSale()
  const settings = useStoreSettings()
  const { data: balances } = useBalances(cart.map((l) => l.product.id))
  const available = new Map(balances?.map((b) => [b.productId, b.quantity]))

  /** Soma em milésimos inteiros: 0,1 + 0,2 em float daria 0,30000000000000004. */
  const toText = (milli: number) => String(milli / 1000).replace('.', ',')

  function addProduct(product: Product, amount = 1) {
    setCart((current) => {
      const existing = current.find((l) => l.product.id === product.id)
      if (!existing) return [...current, { product, quantity: toText(Math.round(amount * 1000)) }]
      // Leu o mesmo código de novo: soma, como no caixa de supermercado (duas etiquetas de banana viram uma linha).
      const milli = Math.round((parseQuantity(existing.quantity) ?? 0) * 1000) + Math.round(amount * 1000)
      return current.map((l) => (l === existing ? { ...l, quantity: toText(milli) } : l))
    })
    setResults(null)
    searchRef.current?.focus()
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault()
    const term = search.trim()
    if (!term) return
    // Limpa o campo JÁ, antes da busca (síncrono). Um leitor de código de barras "digita" a
    // próxima leitura enquanto a anterior ainda está buscando; se o campo fosse limpo quando
    // a resposta chegasse, apagaria a leitura seguinte e o item se perderia (bug achado pelo
    // teste de interface, ADR 0016).
    setSearch('')
    setSearchError(null)
    try {
      const page = await apiGet(`/products${toQueryString({ q: term, pageSize: 10 })}`, productPageSchema)
      // Leitor de código de barras: correspondência exata entra direto no carrinho.
      const exact = page.items.find((p) => p.barcode === term || p.sku === term.toUpperCase())
      if (exact) return addProduct(exact)
      // Etiqueta de balança (ADR 0020): 2 + código do produto + peso (ou preço) + verificador.
      const label = parseScaleLabel(term)
      if (label && settings.data) {
        const byCode = await apiGet(`/products${toQueryString({ scaleCode: label.scaleCode, pageSize: 1 })}`, productPageSchema)
        const product = byCode.items[0]
        if (!product) return setSearchError(`Etiqueta de balança: nenhum produto com o código ${label.scaleCode}`)
        const qty = scaleQuantity(label, settings.data.scaleLabelMode, product.salePriceCents)
        if (qty <= 0) return setSearchError('Etiqueta de balança com peso zerado')
        return addProduct(product, qty)
      }
      if (page.items.length === 1) addProduct(page.items[0]!)
      else if (page.items.length === 0) setSearchError(`Nenhum produto encontrado para "${term}"`)
      else setResults(page.items)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Erro na busca')
    }
  }

  // ─── prévia dos totais (o servidor recalcula e é quem vale) ──────────────
  const parsedLines = cart.map((l) => ({ line: l, qty: parseQuantity(l.quantity) }))
  const discount: SaleDiscount | null = (() => {
    if (discountMode === 'AMOUNT') {
      const cents = parseBrlToCents(discountText)
      return cents === null ? null : { type: 'AMOUNT', valueCents: cents }
    }
    if (discountMode === 'PERCENT') {
      const pct = parseQuantity(discountText)
      return pct === null ? null : { type: 'PERCENT', percent: pct }
    }
    return null
  })()
  let preview: ReturnType<typeof computeSaleTotals> | null = null
  let previewError: string | null = null
  try {
    preview = computeSaleTotals(
      parsedLines.map(({ line, qty }) => ({ quantity: qty ?? 0, unitPriceCents: line.product.salePriceCents })),
      discount,
    )
  } catch (err) {
    previewError = err instanceof Error ? err.message : 'Desconto inválido'
  }
  // Pagamento dividido (D45): a linha em branco recebe o que falta; a regra é a mesma do servidor.
  const typed = payments.map((p) => (p.amount.trim() === '' ? null : parseBrlToCents(p.amount)))
  const invalidAmount = payments.some((p, i) => p.amount.trim() !== '' && typed[i] === null)
  const typedSum = typed.reduce<number>((a, c) => a + (c ?? 0), 0)
  const remaining = preview ? Math.max(preview.totalCents - typedSum, 0) : 0
  // O "que falta" vai para a ÚLTIMA linha em branco; as outras em branco ficam zeradas.
  const lastBlank = typed.lastIndexOf(null)
  const paymentInput = payments.map((p, i) => ({
    method: p.method,
    amountCents: typed[i] ?? (i === lastBlank ? remaining : 0),
  }))
  let settlement: ReturnType<typeof settlePayments> | null = null
  let paymentError: string | null = null
  if (preview && !invalidAmount) {
    try {
      settlement = settlePayments(preview.totalCents, paymentInput)
    } catch (err) {
      paymentError = err instanceof Error ? err.message : 'Pagamento inválido'
    }
  }
  const allMethods = Object.keys(PAYMENT_METHODS) as PaymentMethod[]
  const unusedMethods = allMethods.filter((m) => !payments.some((p) => p.method === m))

  async function finish() {
    setError(null)
    if (parsedLines.some((l) => l.qty === null || l.qty <= 0)) {
      setError('Há itens com quantidade inválida')
      return
    }
    const parsed = createSaleSchema.safeParse({
      items: parsedLines.map(({ line, qty }) => ({ productId: line.product.id, quantity: qty })),
      discount,
      payments: paymentInput,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    try {
      const sale = await createSale.mutateAsync({ input: parsed.data, key })
      setDone(sale)
    } catch (err) {
      // Em 4xx nada foi gravado: o usuário corrige e tenta de novo com a mesma chave.
      // Em falha de rede/5xx o resultado é incerto: reenviar com a MESMA chave é seguro.
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  function newSale() {
    setCart([])
    setDiscountMode('NONE')
    setDiscountText('')
    setPayments([{ method: 'PIX', amount: '' }])
    setError(null)
    setDone(null)
    renewKey() // só aqui a chave muda: a operação anterior terminou com sucesso
    setTimeout(() => searchRef.current?.focus())
  }

  if (done) {
    return (
      <section className="narrow receipt">
        <h1>Venda nº {done.number} registrada</h1>
        <p className="total-line">
          Total <strong>{formatCents(done.totalCents)}</strong>
        </p>
        <p className="muted">{describePayments(done.payments)}</p>
        {done.changeCents > 0 && (
          <p className="change">
            Troco: <strong>{formatCents(done.changeCents)}</strong>
          </p>
        )}
        <div className="actions">
          <Link to={`/vendas/${done.id}`} className="button secondary">
            Ver venda
          </Link>
          <Link to={`/vendas/${done.id}/cupom?imprimir=1`} className="button secondary">
            Imprimir cupom
          </Link>
          <button type="button" autoFocus onClick={newSale}>
            Nova venda
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="pos">
      <div className="pos-main">
        <h1>Nova venda</h1>
        <form onSubmit={onSearch} className="filters">
          <input
            ref={searchRef}
            autoFocus
            type="search"
            placeholder="Código de barras, SKU ou nome + Enter"
            aria-label="Adicionar produto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="secondary">
            Buscar
          </button>
        </form>
        {searchError && <p className="error">{searchError}</p>}
        {results && (
          <ul className="search-results">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" className="secondary" onClick={() => addProduct(p)}>
                  <span className="mono">{p.sku}</span> {p.name} · {formatCents(p.salePriceCents)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Qtd.</th>
                <th className="num">Preço</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cart.map((line, i) => {
                const qty = parseQuantity(line.quantity)
                const stock = available.get(line.product.id)
                const overStock = qty !== null && stock !== undefined && qty > stock
                const fractionError = qty !== null && !isFractionalUnit(line.product.unit) && !Number.isInteger(qty)
                return (
                  <tr key={line.product.id}>
                    <td>
                      {line.product.name} <span className="muted mono">{line.product.sku}</span>
                      {overStock && <div className="field-error">Saldo disponível: {formatQuantity(stock)}</div>}
                      {fractionError && <div className="field-error">{line.product.unit} não aceita fração</div>}
                    </td>
                    <td className="num">
                      <input
                        className="qty-input"
                        aria-label={`Quantidade de ${line.product.name}`}
                        inputMode={isFractionalUnit(line.product.unit) ? 'decimal' : 'numeric'}
                        value={line.quantity}
                        onChange={(e) =>
                          setCart((c) => c.map((l) => (l === line ? { ...l, quantity: e.target.value } : l)))
                        }
                      />{' '}
                      {line.product.unit}
                    </td>
                    <td className="num">{formatCents(line.product.salePriceCents)}</td>
                    <td className="num">{preview ? formatCents(preview.lines[i]!.grossCents) : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary small"
                        aria-label={`Remover ${line.product.name}`}
                        onClick={() => setCart((c) => c.filter((l) => l !== line))}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                )
              })}
              {cart.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted center">
                    Leia um código de barras ou busque um produto para começar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="pos-side panel">
        <label>
          Desconto
          <div className="inline">
            <select value={discountMode} onChange={(e) => setDiscountMode(e.target.value as DiscountMode)}>
              <option value="NONE">Sem desconto</option>
              <option value="AMOUNT">R$</option>
              <option value="PERCENT">%</option>
            </select>
            {discountMode !== 'NONE' && (
              <input
                inputMode="decimal"
                aria-label="Valor do desconto"
                placeholder={discountMode === 'AMOUNT' ? '5,00' : '10'}
                value={discountText}
                onChange={(e) => setDiscountText(e.target.value)}
              />
            )}
          </div>
        </label>

        <fieldset className="plain">
          <legend>Pagamento</legend>
          {payments.map((p, i) => (
            <div className="payment-line" key={p.method}>
              <select
                aria-label={`Forma de pagamento ${i + 1}`}
                value={p.method}
                onChange={(e) =>
                  setPayments((list) => list.map((l) => (l === p ? { ...l, method: e.target.value as PaymentMethod } : l)))
                }
              >
                {allMethods
                  .filter((m) => m === p.method || unusedMethods.includes(m))
                  .map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHODS[m]}
                    </option>
                  ))}
              </select>
              <input
                inputMode="decimal"
                aria-label={`Valor em ${PAYMENT_METHODS[p.method]}`}
                placeholder={i === lastBlank ? centsToInput(remaining) : '0,00'}
                value={p.amount}
                onChange={(e) => setPayments((list) => list.map((l) => (l === p ? { ...l, amount: e.target.value } : l)))}
              />
              {payments.length > 1 ? (
                <button
                  type="button"
                  className="secondary small"
                  aria-label={`Remover ${PAYMENT_METHODS[p.method]}`}
                  onClick={() => setPayments((list) => list.filter((l) => l !== p))}
                >
                  ×
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          {unusedMethods.length > 0 && (
            <button
              type="button"
              className="secondary small"
              onClick={() => setPayments((list) => [...list, { method: unusedMethods[0]!, amount: '' }])}
            >
              Dividir pagamento
            </button>
          )}
        </fieldset>

        <dl className="totals">
          <dt>Subtotal</dt>
          <dd>{preview ? formatCents(preview.subtotalCents) : '—'}</dd>
          <dt>Desconto</dt>
          <dd>{preview ? `− ${formatCents(preview.discountCents)}` : '—'}</dd>
          <dt className="grand">Total</dt>
          <dd className="grand">{preview ? formatCents(preview.totalCents) : '—'}</dd>
          {settlement && settlement.changeCents > 0 && (
            <>
              <dt>Troco</dt>
              <dd>{formatCents(settlement.changeCents)}</dd>
            </>
          )}
        </dl>
        {previewError && <p className="error">{previewError}</p>}
        {invalidAmount && <p className="error">Valor de pagamento inválido</p>}
        {cart.length > 0 && paymentError && <p className="error">{paymentError}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          className="finish"
          disabled={cart.length === 0 || createSale.isPending || previewError !== null || settlement === null}
          onClick={() => void finish()}
        >
          {createSale.isPending ? 'Finalizando…' : 'Finalizar venda'}
        </button>
        <p className="muted small-text">Os valores finais são calculados pelo servidor com os preços vigentes.</p>
      </aside>
    </section>
  )
}
