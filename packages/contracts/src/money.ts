import { z } from 'zod';

/**
 * Valores monetários trafegam SEMPRE em centavos (inteiro).
 * Ver docs/adr/0004-dinheiro-em-centavos.md
 */
export const centsSchema = z
  .number()
  .int('Valor monetário deve estar em centavos (inteiro)')
  .nonnegative('Valor não pode ser negativo')
  // R$ 10 milhões: folga confortável abaixo do limite da coluna INTEGER do Postgres (~2,1 bi).
  .max(1_000_000_000, 'Valor acima do limite permitido');

export type Cents = z.infer<typeof centsSchema>;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata centavos para exibição: 1990 -> "R$ 19,90". Só use na borda (UI/relatórios). */
export function formatCents(cents: Cents): string {
  return brl.format(cents / 100);
}

/**
 * Converte o que o usuário digita ("1.234,56", "19,9", "R$ 10") em centavos.
 * Trabalha com TEXTO, sem passar por float: "0,1" vira 10 centavos exatos.
 * Retorna null se o texto não for um valor válido.
 */
export function parseBrlToCents(input: string): Cents | null {
  const text = input.replace(/R\$/i, '').replace(/\s/g, '');
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(text);
  if (!m) return null;

  const reais = m[1]!.replaceAll('.', '');
  const centavos = (m[2] ?? '').padEnd(2, '0');
  const cents = Number(reais) * 100 + Number(centavos);
  return centsSchema.safeParse(cents).success ? cents : null;
}

/** Centavos -> texto editável num input ("1234,56"), sem símbolo nem separador de milhar. */
export function centsToInput(cents: Cents): string {
  const reais = Math.trunc(cents / 100);
  const resto = String(cents % 100).padStart(2, '0');
  return `${reais},${resto}`;
}
