import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { formatCents, GRANULARITIES, periodSchema, type Granularity, type Period } from '@mini-erp/contracts'
import { ColumnChart, type ColumnPoint } from '../../components/ColumnChart.tsx'
import {
  csvUrl,
  useAbcReport,
  useInventoryValue,
  useMarginReport,
  useReorderReport,
  useSalesReport,
  useSellersReport,
  useStaleReport,
} from '../../lib/reports-queries.ts'
import { formatQuantity } from '../../lib/quantity.ts'

/** Data local (fuso do navegador) em AAAA-MM-DD. */
const isoLocal = (d: Date) => d.toLocaleDateString('sv-SE')
const daysAgo = (n: number) => isoLocal(new Date(Date.now() - n * 86_400_000))

const PRESETS: { label: string; period: () => Period }[] = [
  { label: 'Hoje', period: () => ({ from: daysAgo(0), to: daysAgo(0) }) },
  { label: '7 dias', period: () => ({ from: daysAgo(6), to: daysAgo(0) }) },
  { label: '30 dias', period: () => ({ from: daysAgo(29), to: daysAgo(0) }) },
  {
    label: 'Este mês',
    period: () => {
      const now = new Date()
      return { from: isoLocal(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoLocal(now) }
    },
  },
  { label: '12 meses', period: () => ({ from: daysAgo(364), to: daysAgo(0) }) },
]

const GRANULARITY_LABEL: Record<Granularity, string> = { day: 'Dia', week: 'Semana', month: 'Mês' }
const brDate = (iso: string) => iso.split('-').reverse().join('/')
const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
const compactBrl = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`)

export function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const fallback = PRESETS[2]!.period()
  const candidate = { from: params.get('de') ?? fallback.from, to: params.get('ate') ?? fallback.to }
  const period: Period = periodSchema.safeParse(candidate).success ? candidate : fallback
  const granularity = (GRANULARITIES as readonly string[]).includes(params.get('por') ?? '')
    ? (params.get('por') as Granularity)
    : 'day'

  function update(changes: Record<string, string>) {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(changes)) next.set(k, v)
      return next
    }, { replace: true })
  }
  const setPeriod = (p: Period) => update({ de: p.from, ate: p.to })
  const [draft, setDraft] = useState(period)
  const draftValid = periodSchema.safeParse(draft)

  return (
    <section>
      <div className="row">
        <h1>Relatórios</h1>
      </div>

      {/* Filtros numa linha só, acima de tudo: valem para a página inteira. */}
      <div className="report-filters">
        <div className="presets" role="group" aria-label="Período rápido">
          {PRESETS.map((p) => {
            const value = p.period()
            const selected = value.from === period.from && value.to === period.to
            return (
              <button
                key={p.label}
                type="button"
                className={`small ${selected ? '' : 'secondary'}`}
                aria-pressed={selected}
                onClick={() => {
                  setPeriod(value)
                  setDraft(value)
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault()
            if (draftValid.success) setPeriod(draft)
          }}
        >
          <input type="date" aria-label="De" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <input type="date" aria-label="Até" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <button type="submit" className="small" disabled={!draftValid.success}>
            Aplicar
          </button>
        </form>
      </div>
      {!draftValid.success && <p className="error">{draftValid.error.issues[0]?.message}</p>}
      <p className="muted">
        {brDate(period.from)} a {brDate(period.to)} · horário de Brasília · vendas canceladas não entram na receita
      </p>

      <SalesSection period={period} granularity={granularity} onGranularity={(g) => update({ por: g })} />
      <AbcSection period={period} />
      <MarginSection period={period} />
      <SellersSection period={period} />
      <InventorySection />
    </section>
  )
}

// ─── Seções ──────────────────────────────────────────────────────────────

function SalesSection({ period, granularity, onGranularity }: { period: Period; granularity: Granularity; onGranularity: (g: Granularity) => void }) {
  const { data, isError, error, isPlaceholderData } = useSalesReport(period, granularity)
  if (isError) return <p className="error">Erro ao carregar vendas: {error.message}</p>
  if (!data) return <p className="muted">Carregando…</p>
  const t = data.totals

  const points: ColumnPoint[] = data.series.map((p) => ({
    key: p.bucket,
    label: granularity === 'month' ? brDate(p.bucket).slice(3) : brDate(p.bucket).slice(0, 5),
    title:
      granularity === 'day'
        ? `${weekday.format(new Date(`${p.bucket}T12:00:00`))}, ${brDate(p.bucket)}`
        : granularity === 'week'
          ? `Semana de ${brDate(p.bucket)}`
          : brDate(p.bucket).slice(3),
    value: p.netCents,
    details: [`${p.salesCount} venda(s)`, `Margem ${formatCents(p.marginCents)}`],
  }))

  return (
    <div className={isPlaceholderData ? 'loading' : undefined}>
      <div className="stats">
        <Kpi
          label="Receita líquida"
          value={formatCents(t.netCents)}
          hint={
            [
              t.discountCents && `${formatCents(t.discountCents)} em descontos`,
              t.returnsCents && `${formatCents(t.returnsCents)} em devoluções`,
            ]
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />
        <Kpi label="Margem bruta" value={formatCents(t.marginCents)} hint={`${pct(t.marginPct)} da receita`} />
        <Kpi label="Ticket médio" value={formatCents(t.avgTicketCents)} />
        <Kpi label="Vendas" value={t.salesCount.toLocaleString('pt-BR')} hint={t.canceledCount ? `${t.canceledCount} cancelada(s)` : undefined} />
      </div>

      <div className="panel">
        <div className="row">
          <h2>Receita líquida por {GRANULARITY_LABEL[granularity].toLowerCase()}</h2>
          <div className="presets" role="group" aria-label="Agrupar por">
            {GRANULARITIES.map((g) => (
              <button key={g} type="button" className={`small ${g === granularity ? '' : 'secondary'}`} aria-pressed={g === granularity} onClick={() => onGranularity(g)}>
                {GRANULARITY_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
        {t.salesCount === 0 ? (
          <p className="muted center">Nenhuma venda concluída no período.</p>
        ) : (
          <ColumnChart
            points={points}
            formatValue={formatCents}
            formatTick={(v) => `R$ ${compactBrl.format(v / 100)}`}
            ariaLabel={`Receita líquida por ${GRANULARITY_LABEL[granularity].toLowerCase()}, de ${brDate(period.from)} a ${brDate(period.to)}`}
          />
        )}
        {/* Alternativa acessível ao gráfico: os mesmos números em tabela. */}
        <details>
          <summary>Ver como tabela</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="num">Vendas</th>
                  <th className="num">Receita</th>
                  <th className="num">Margem</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((p, i) => (
                  <tr key={p.bucket}>
                    <td>{points[i]!.title}</td>
                    <td className="num">{p.salesCount}</td>
                    <td className="num">{formatCents(p.netCents)}</td>
                    <td className="num">{formatCents(p.marginCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  )
}

function AbcSection({ period }: { period: Period }) {
  const { data } = useAbcReport(period)
  const [all, setAll] = useState(false)
  if (!data) return null
  const counts = { A: 0, B: 0, C: 0 }
  data.forEach((r) => counts[r.abcClass]++)
  const rows = all ? data : data.slice(0, 15)

  return (
    <ReportPanel title="Curva ABC" subtitle="A: produtos que formam 80% da receita · B: até 95% · C: o restante" csv={csvUrl('abc', { ...period })}>
      <p className="muted">
        {data.length} produto(s) vendidos · A: {counts.A} · B: {counts.B} · C: {counts.C}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Classe</th>
              <th>Produto</th>
              <th className="num">Receita</th>
              <th className="num">Participação</th>
              <th className="num">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <td>
                  <span className={`badge abc-${r.abcClass}`}>{r.abcClass}</span>
                </td>
                <td>
                  <Link to={`/produtos/${r.productId}`}>{r.name}</Link> <span className="muted mono">{r.sku}</span>
                </td>
                <td className="num">{formatCents(r.netCents)}</td>
                <td className="num">{pct(r.sharePct)}</td>
                <td className="num">{pct(r.cumulativePct)}</td>
              </tr>
            ))}
            {data.length === 0 && <EmptyRow cols={5} />}
          </tbody>
        </table>
      </div>
      {data.length > 15 && (
        <button type="button" className="secondary small" onClick={() => setAll(!all)}>
          {all ? 'Mostrar só os 15 primeiros' : `Mostrar todos (${data.length})`}
        </button>
      )}
    </ReportPanel>
  )
}

function MarginSection({ period }: { period: Period }) {
  const [groupBy, setGroupBy] = useState<'product' | 'category'>('category')
  const { data } = useMarginReport(period, groupBy)

  return (
    <ReportPanel
      title="Margem"
      subtitle="Receita líquida menos o custo médio de cada item no momento da venda"
      csv={csvUrl('margin', { ...period, groupBy })}
      actions={
        <div className="presets" role="group" aria-label="Agrupar margem por">
          {(['category', 'product'] as const).map((g) => (
            <button key={g} type="button" className={`small ${g === groupBy ? '' : 'secondary'}`} aria-pressed={g === groupBy} onClick={() => setGroupBy(g)}>
              {g === 'category' ? 'Categoria' : 'Produto'}
            </button>
          ))}
        </div>
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{groupBy === 'category' ? 'Categoria' : 'Produto'}</th>
              <th className="num">Qtd.</th>
              <th className="num">Receita</th>
              <th className="num">Custo</th>
              <th className="num">Margem</th>
              <th className="num">Margem %</th>
            </tr>
          </thead>
          <tbody>
            {data?.slice(0, 50).map((r) => (
              <tr key={r.id ?? 'sem-categoria'}>
                <td>
                  {r.name} {r.sku && <span className="muted mono">{r.sku}</span>}
                </td>
                <td className="num">{formatQuantity(r.quantity)}</td>
                <td className="num">{formatCents(r.netCents)}</td>
                <td className="num">{formatCents(r.costCents)}</td>
                <td className={`num${r.marginCents < 0 ? ' down' : ''}`}>{formatCents(r.marginCents)}</td>
                <td className="num">{pct(r.marginPct)}</td>
              </tr>
            ))}
            {data?.length === 0 && <EmptyRow cols={6} />}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  )
}

function SellersSection({ period }: { period: Period }) {
  const { data } = useSellersReport(period)
  return (
    <ReportPanel title="Vendedores" csv={csvUrl('sellers', { ...period })}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Vendedor</th>
              <th className="num">Vendas</th>
              <th className="num">Canceladas</th>
              <th className="num">Receita</th>
              <th className="num">Ticket médio</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.userId}>
                <td>{r.name}</td>
                <td className="num">{r.salesCount}</td>
                <td className="num">{r.canceledCount}</td>
                <td className="num">{formatCents(r.netCents)}</td>
                <td className="num">{formatCents(r.avgTicketCents)}</td>
              </tr>
            ))}
            {data?.length === 0 && <EmptyRow cols={5} />}
          </tbody>
        </table>
      </div>
    </ReportPanel>
  )
}

function InventorySection() {
  const [days, setDays] = useState(60)
  const { data: value } = useInventoryValue()
  const { data: reorder } = useReorderReport()
  const { data: stale } = useStaleReport(days)

  return (
    <>
      <h2 className="section-title">Estoque (posição atual)</h2>
      <div className="stats">
        <Kpi label="Valor em estoque (a custo)" value={value ? formatCents(value.valueCents) : '—'} hint={value ? `${value.productsWithStock} produto(s) com saldo` : undefined} />
        <Kpi label="Para repor" value={value ? String(value.reorderCount) : '—'} hint="abaixo do estoque mínimo" alert={(value?.reorderCount ?? 0) > 0} />
      </div>

      <ReportPanel title="Lista de reposição" csv={csvUrl('reorder', {})}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Saldo</th>
                <th className="num">Mínimo</th>
                <th className="num">Faltam</th>
              </tr>
            </thead>
            <tbody>
              {reorder?.map((r) => (
                <tr key={r.productId}>
                  <td>
                    <Link to={`/estoque/${r.productId}`}>{r.name}</Link> <span className="muted mono">{r.sku}</span>
                  </td>
                  <td className="num down">
                    {formatQuantity(r.quantity)} {r.unit}
                  </td>
                  <td className="num">{formatQuantity(r.minStock)}</td>
                  <td className="num">{formatQuantity(r.missing)}</td>
                </tr>
              ))}
              {reorder?.length === 0 && <EmptyRow cols={4} text="Nenhum produto abaixo do mínimo." />}
            </tbody>
          </table>
        </div>
      </ReportPanel>

      <ReportPanel
        title="Produtos parados"
        subtitle="Com saldo e sem venda no período escolhido: capital empatado"
        csv={csvUrl('stale', { days })}
        actions={
          <select aria-label="Sem venda há" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[30, 60, 90, 180].map((d) => (
              <option key={d} value={d}>
                sem venda há {d} dias
              </option>
            ))}
          </select>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Saldo</th>
                <th className="num">Valor parado</th>
                <th>Última venda</th>
              </tr>
            </thead>
            <tbody>
              {stale?.slice(0, 50).map((r) => (
                <tr key={r.productId}>
                  <td>
                    <Link to={`/estoque/${r.productId}`}>{r.name}</Link> <span className="muted mono">{r.sku}</span>
                  </td>
                  <td className="num">
                    {formatQuantity(r.quantity)} {r.unit}
                  </td>
                  <td className="num">{formatCents(r.valueCents)}</td>
                  <td>{r.lastSaleAt ? new Date(r.lastSaleAt).toLocaleDateString('pt-BR') : 'nunca vendido'}</td>
                </tr>
              ))}
              {stale?.length === 0 && <EmptyRow cols={4} text="Nenhum produto parado." />}
            </tbody>
          </table>
        </div>
      </ReportPanel>
    </>
  )
}

// ─── Peças ───────────────────────────────────────────────────────────────

function Kpi({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div className={`stat${alert ? ' stat-alert' : ''}`}>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="muted small-text">{hint}</span>}
    </div>
  )
}

function ReportPanel({
  title,
  subtitle,
  csv,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  csv: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="panel">
      <div className="row">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted small-text">{subtitle}</p>}
        </div>
        <div className="actions">
          {actions}
          <a className="button secondary small" href={csv} download>
            Exportar CSV
          </a>
        </div>
      </div>
      {children}
    </div>
  )
}

function EmptyRow({ cols, text = 'Sem dados no período.' }: { cols: number; text?: string }) {
  return (
    <tr>
      <td colSpan={cols} className="muted center">
        {text}
      </td>
    </tr>
  )
}
