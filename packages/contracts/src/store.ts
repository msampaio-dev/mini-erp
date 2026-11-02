import { z } from 'zod';
import { isValidGtin } from './gtin.js';

/**
 * Etiqueta de balança (ADR 0020). A balança imprime um EAN-13 de uso interno:
 *
 *   2 CCCCCC VVVVV D
 *   │ │      │     └ dígito verificador (o mesmo cálculo do EAN)
 *   │ │      └ valor: peso em gramas (WEIGHT) ou preço total em centavos (PRICE)
 *   │ └ código do produto na balança (6 dígitos)
 *   └ prefixo 2: código de circulação restrita (uso interno da loja)
 *
 * Qual dos dois valores a balança imprime é configuração dela: o sistema precisa saber
 * (SCALE_LABEL_MODE na API). Ler peso como se fosse preço erraria a quantidade.
 */
export const SCALE_LABEL_MODES = ['WEIGHT', 'PRICE'] as const;
export type ScaleLabelMode = (typeof SCALE_LABEL_MODES)[number];

export interface ScaleLabel {
  scaleCode: string;
  value: number;
}

export function parseScaleLabel(code: string): ScaleLabel | null {
  if (!/^2\d{12}$/.test(code) || !isValidGtin(code)) return null;
  return { scaleCode: code.slice(1, 7), value: Number(code.slice(7, 12)) };
}

/**
 * Quantidade em KG a partir da etiqueta.
 * WEIGHT: exato (gramas → kg, 3 casas).
 * PRICE: preço ÷ preço por kg, arredondado a 3 casas. O total recalculado pode diferir da
 * etiqueta em 1 centavo (ADR 0020): por isso o modo recomendado é WEIGHT.
 */
export function scaleQuantity(label: ScaleLabel, mode: ScaleLabelMode, unitPriceCents: number): number {
  if (mode === 'WEIGHT') return label.value / 1000;
  return unitPriceCents > 0 ? Math.round((label.value * 1000) / unitPriceCents) / 1000 : 0;
}

/** Dados da loja para o cupom e configuração do PDV (variáveis de ambiente da API). */
export const storeSettingsSchema = z.object({
  name: z.string(),
  document: z.string(),
  address: z.string(),
  scaleLabelMode: z.enum(SCALE_LABEL_MODES),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;
