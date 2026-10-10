import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

export interface ColumnPoint {
  key: string
  /** Rótulo curto no eixo X (ex.: "10/10"). */
  label: string
  /** Rótulo completo no tooltip (ex.: "sex, 10/10/2026"). */
  title: string
  value: number
  /** Linhas extras no tooltip (ex.: "3 vendas"). */
  details?: string[]
}

interface Props {
  points: ColumnPoint[]
  formatValue: (v: number) => string
  /** Formato curto para os ticks do eixo Y (ex.: "R$ 1,2 mil"). */
  formatTick: (v: number) => string
  ariaLabel: string
}

const HEIGHT = 220
const PAD = { top: 12, right: 8, bottom: 26, left: 64 }
const MAX_BAR = 24 // colunas finas: nunca preenchem a faixa inteira
const RADIUS = 4 // canto arredondado só na ponta (o lado da base fica reto)
const MIN_BAND = 6 // abaixo disso o gráfico rola em vez de espremer as colunas

/** Ticks "redondos" (0, 500, 1.000...) em vez de valores quebrados. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

/** Coluna com topo arredondado e base reta. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

/**
 * Gráfico de colunas de UMA série (sem legenda: o título da seção diz o que é).
 * Tooltip ao passar o mouse ou focar pelo teclado; a faixa inteira é a área de hover.
 */
export function ColumnChart({ points, formatValue, formatTick, ariaLabel }: Props) {
  const [active, setActive] = useState<number | null>(null)
  const titleId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(640)

  // Desenha no tamanho REAL em pixels (sem escalar o viewBox): o texto fica sempre com 11px,
  // em vez de encolher junto com o gráfico no celular.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const observer = new ResizeObserver(([entry]) => setBoxWidth(Math.floor(entry!.contentRect.width)))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  const width = Math.max(boxWidth, points.length * MIN_BAND + PAD.left + PAD.right)

  // Se precisar rolar (ex.: 365 dias), abre no fim: o período mais recente é o que interessa.
  useEffect(() => {
    const box = boxRef.current
    if (box && width > boxWidth) box.scrollLeft = box.scrollWidth
  }, [width, boxWidth])

  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const ticks = niceTicks(Math.max(0, ...points.map((p) => p.value)))
  const top = ticks[ticks.length - 1] || 1
  const band = plotW / Math.max(points.length, 1)
  // Colunas encostadas (faixa estreita) mantêm 2px de respiro entre si.
  const barW = Math.max(2, Math.min(MAX_BAR, band - 2))
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  // Rótulos do eixo X espaçados para não colidir (~ 1 a cada 48px).
  const labelEvery = Math.max(1, Math.ceil(48 / band))
  const current = active === null ? null : points[active]

  return (
    <div className="chart" ref={boxRef}>
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setActive(null)}
      >
        <title id={titleId}>{ariaLabel}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="chart-tick" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {formatTick(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = PAD.left + band * i + band / 2
          const h = Math.max(0, PAD.top + plotH - y(p.value))
          return (
            <g key={p.key}>
              {h > 0 && (
                <path
                  className={`chart-bar${active === i ? ' is-active' : ''}`}
                  d={columnPath(cx - barW / 2, y(p.value), barW, h)}
                />
              )}
              {i % labelEvery === 0 && (
                <text className="chart-tick" x={cx} y={HEIGHT - 8} textAnchor="middle">
                  {p.label}
                </text>
              )}
              {/* Área de hover = faixa inteira, maior que a coluna. */}
              <rect
                className="chart-hit"
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={plotH}
                tabIndex={0}
                aria-label={`${p.title}: ${formatValue(p.value)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </g>
          )
        })}
        <line className="chart-axis" x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} />
      </svg>
      {current && active !== null && (
        <div
          className="chart-tooltip"
          role="status"
          style={{ left: PAD.left + band * active + band / 2, top: y(current.value) }}
        >
          <strong>{formatValue(current.value)}</strong>
          <span>{current.title}</span>
          {current.details?.map((d) => <span key={d}>{d}</span>)}
        </div>
      )}
    </div>
  )
}
