/** "2,5" ou "2.5" -> 2.5. Aceita sinal (ajustes). Retorna null se não for número. */
export function parseQuantity(input: string): number | null {
  const text = input.trim().replace(',', '.')
  if (!/^[+-]?\d+(\.\d{1,3})?$/.test(text)) return null
  return Number(text)
}

const qtyFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })

export function formatQuantity(n: number, opts: { signed?: boolean } = {}): string {
  const text = qtyFormat.format(n)
  return opts.signed && n > 0 ? `+${text}` : text
}

/** Custo médio pode ter fração de centavo: exibe com até 4 casas. */
const costFormat = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

export function formatCostCents(cents: number): string {
  return costFormat.format(cents / 100)
}
