import { z } from 'zod';
import { centsSchema } from './money.js';
import { pageQuerySchema, pageSchema } from './pagination.js';

/** Cabeçalho que torna as escritas de estoque idempotentes (ADR 0010). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export const MOVEMENT_TYPES = ['ENTRY', 'ADJUSTMENT', 'REVERSAL', 'SALE', 'RETURN'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  ENTRY: 'Entrada',
  ADJUSTMENT: 'Ajuste',
  REVERSAL: 'Estorno',
  SALE: 'Venda',
  RETURN: 'Devolução de cliente',
};

export const ADJUSTMENT_REASONS = {
  AVARIA: 'Avaria',
  PERDA: 'Perda ou extravio',
  INVENTARIO: 'Contagem de inventário',
  OUTRO: 'Outro (descrever)',
} as const;
export type AdjustmentReason = keyof typeof ADJUSTMENT_REASONS;
const ADJUSTMENT_REASON_KEYS = Object.keys(ADJUSTMENT_REASONS) as [AdjustmentReason, ...AdjustmentReason[]];

const hasAtMost3Decimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

/** Quantidade movimentada: diferente de zero, até 3 casas, com sinal (+ entra, - sai). */
const signedQuantitySchema = z
  .number()
  .refine((n) => n !== 0, 'A quantidade não pode ser zero')
  .refine((n) => Math.abs(n) <= 1_000_000_000, 'Quantidade acima do limite')
  .refine(hasAtMost3Decimals, 'No máximo 3 casas decimais');

const noteSchema = z.string().trim().max(500, 'Observação muito longa').default('');

export const createEntrySchema = z.object({
  productId: z.uuid(),
  quantity: signedQuantitySchema.refine((n) => n > 0, 'A quantidade da entrada deve ser positiva'),
  /** Custo unitário de compra, em centavos: alimenta o custo médio (ADR 0010). */
  unitCostCents: centsSchema,
  note: noteSchema,
});
export type CreateEntryInput = z.infer<typeof createEntrySchema>;

export const createAdjustmentSchema = z
  .object({
    productId: z.uuid(),
    /** Positivo = sobrou (achado no inventário); negativo = faltou (avaria, perda). */
    quantity: signedQuantitySchema,
    reason: z.enum(ADJUSTMENT_REASON_KEYS),
    note: noteSchema,
  })
  .refine((a) => a.reason !== 'OUTRO' || a.note.length >= 3, {
    message: 'Descreva o motivo do ajuste',
    path: ['note'],
  });
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;

export const reverseMovementSchema = z.object({
  note: z.string().trim().min(3, 'Informe o motivo do estorno').max(500),
});
export type ReverseMovementInput = z.infer<typeof reverseMovementSchema>;

export const movementSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  type: z.enum(MOVEMENT_TYPES),
  quantity: z.number(),
  unitCostCents: z.number().int().nullable(),
  reason: z.enum(ADJUSTMENT_REASON_KEYS).nullable(),
  note: z.string(),
  /** Saldo do produto logo após esta movimentação (coluna "saldo" do kardex). */
  balanceAfter: z.number(),
  reversalOfId: z.uuid().nullable(),
  /** Preenchido se esta movimentação já foi estornada. */
  reversedById: z.uuid().nullable(),
  createdBy: z.object({ id: z.uuid(), name: z.string() }),
  createdAt: z.iso.datetime(),
});
export type Movement = z.infer<typeof movementSchema>;

export const movementListQuerySchema = pageQuerySchema.extend({ productId: z.uuid() });
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;
export const movementPageSchema = pageSchema(movementSchema);

export const balanceSchema = z.object({
  productId: z.uuid(),
  quantity: z.number(),
  /** Custo médio ponderado por unidade, em centavos (pode ter fração de centavo). */
  avgCostCents: z.number(),
  /** quantidade × custo médio, arredondado para centavos. */
  totalValueCents: z.number().int(),
});
export type Balance = z.infer<typeof balanceSchema>;

/** ?productIds=a,b,c — saldos de vários produtos de uma vez (ex.: coluna da listagem). */
export const balancesQuerySchema = z.object({
  productIds: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(100)),
});
export type BalancesQuery = z.infer<typeof balancesQuerySchema>;
