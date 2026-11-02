import { z } from 'zod';
import { centsSchema } from './money.js';
import { pageQuerySchema, pageSchema } from './pagination.js';
import { PAYMENT_METHODS, type PaymentMethod } from './sales.js';

/**
 * Caixa (ADR 0018). Cada operador abre o SEU caixa; toda venda pertence a uma sessão.
 * O dinheiro da gaveta é um livro-razão (cash_movements), como o estoque: o valor esperado
 * no fechamento é a soma das movimentações, nunca um número editado à mão.
 */
export const CASH_MOVEMENT_TYPES = {
  OPENING: 'Abertura (troco inicial)',
  SUPPLY: 'Suprimento',
  WITHDRAWAL: 'Sangria',
  SALE: 'Venda em dinheiro',
  SALE_CANCEL: 'Cancelamento de venda',
  REFUND: 'Devolução em dinheiro',
} as const;
export type CashMovementType = keyof typeof CASH_MOVEMENT_TYPES;
const CASH_MOVEMENT_KEYS = Object.keys(CASH_MOVEMENT_TYPES) as [CashMovementType, ...CashMovementType[]];

const noteSchema = z.string().trim().max(500).default('');

export const openCashSchema = z.object({
  /** Troco inicial na gaveta. Pode ser zero. */
  openingCents: centsSchema,
  note: noteSchema,
});
export type OpenCashInput = z.infer<typeof openCashSchema>;

/** Movimentações manuais: só suprimento (entra) e sangria (sai). As demais nascem das vendas. */
export const cashMovementInputSchema = z.object({
  type: z.enum(['SUPPLY', 'WITHDRAWAL']),
  amountCents: centsSchema.refine((n) => n > 0, 'Informe um valor maior que zero'),
  note: z.string().trim().min(3, 'Descreva o motivo').max(500),
});
export type CashMovementInput = z.infer<typeof cashMovementInputSchema>;

export const closeCashSchema = z.object({
  /** Dinheiro contado na gaveta. O operador informa ANTES de ver o esperado (fechamento cego, D46). */
  countedCents: centsSchema,
  note: noteSchema,
});
export type CloseCashInput = z.infer<typeof closeCashSchema>;

const userRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const cashMovementSchema = z.object({
  id: z.uuid(),
  type: z.enum(CASH_MOVEMENT_KEYS),
  /** Com sinal: positivo entra na gaveta, negativo sai. */
  amountCents: z.number().int(),
  note: z.string(),
  saleNumber: z.number().int().nullable(),
  createdBy: userRefSchema,
  createdAt: z.iso.datetime(),
});
export type CashMovement = z.infer<typeof cashMovementSchema>;

/**
 * Valores que revelam o esperado. `null` para quem só opera o caixa enquanto ele está aberto:
 * no fechamento cego, o operador conta sem saber quanto "deveria" ter.
 */
const cashTotalsSchema = z.object({
  expectedCents: z.number().int(),
  /** Vendas concluídas da sessão, por forma de pagamento (líquido de troco). */
  byMethod: z.array(
    z.object({ method: z.enum(Object.keys(PAYMENT_METHODS) as [PaymentMethod]), amountCents: z.number().int() }),
  ),
  movements: z.array(cashMovementSchema),
});

export const cashSessionSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  operator: userRefSchema,
  openedAt: z.iso.datetime(),
  openingCents: z.number().int(),
  salesCount: z.number().int(),
  closedAt: z.iso.datetime().nullable(),
  closedBy: userRefSchema.nullable(),
  countedCents: z.number().int().nullable(),
  /** Sobra (+) ou falta (−) no fechamento. */
  differenceCents: z.number().int().nullable(),
  closingNote: z.string(),
  totals: cashTotalsSchema.nullable(),
});
export type CashSession = z.infer<typeof cashSessionSchema>;

export const cashSessionSummarySchema = cashSessionSchema.omit({ totals: true }).extend({
  expectedCents: z.number().int().nullable(),
});
export type CashSessionSummary = z.infer<typeof cashSessionSummarySchema>;

export const cashSessionListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['OPEN', 'CLOSED', 'ALL']).default('ALL'),
});
export type CashSessionListQuery = z.infer<typeof cashSessionListQuerySchema>;
export const cashSessionPageSchema = pageSchema(cashSessionSummarySchema);
