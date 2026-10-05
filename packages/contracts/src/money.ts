import { z } from 'zod';

/**
 * Valores monetários trafegam SEMPRE em centavos (inteiro).
 * Ver docs/adr/0004-dinheiro-em-centavos.md
 */
export const centsSchema = z
  .number()
  .int('Valor monetário deve estar em centavos (inteiro)')
  .nonnegative();

export type Cents = z.infer<typeof centsSchema>;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata centavos para exibição: 1990 -> "R$ 19,90". Só use na borda (UI/relatórios). */
export function formatCents(cents: Cents): string {
  return brl.format(cents / 100);
}
