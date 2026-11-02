import { z } from 'zod';
import { UNIT_KEYS } from './catalog.js';
import { centsSchema } from './money.js';
import { pageQuerySchema, pageSchema } from './pagination.js';

export const PAYMENT_METHODS = {
  CASH: 'Dinheiro',
  PIX: 'Pix',
  DEBIT: 'Cartão de débito',
  CREDIT: 'Cartão de crédito',
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
const PAYMENT_KEYS = Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]];

export const SALE_STATUSES = ['COMPLETED', 'CANCELED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

const itemQuantitySchema = z
  .number()
  .positive('A quantidade deve ser positiva')
  .max(100_000, 'Quantidade acima do limite por item')
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'No máximo 3 casas decimais');

export const saleDiscountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('AMOUNT'), valueCents: centsSchema }),
  z.object({
    type: z.literal('PERCENT'),
    percent: z
      .number()
      .min(0)
      .max(100, 'Desconto máximo de 100%')
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'No máximo 2 casas decimais'),
  }),
]);

/**
 * O cliente envia SÓ produto e quantidade. Preço vem do servidor (preço vigente no catálogo):
 * um preço enviado pelo navegador poderia ser adulterado.
 */
export const createSaleSchema = z.object({
  items: z
    .array(z.object({ productId: z.uuid(), quantity: itemQuantitySchema }))
    .min(1, 'Adicione ao menos um item')
    .max(200, 'Venda com itens demais')
    .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, {
      message: 'Produto repetido: ajuste a quantidade em uma única linha',
    }),
  discount: saleDiscountSchema.nullable().default(null),
  /**
   * Pagamento dividido (D45): um valor por meio. Em dinheiro, o valor é o ENTREGUE pelo cliente
   * (o troco sai dele); nos demais, nunca passa do que falta pagar.
   */
  payments: z
    .array(z.object({ method: z.enum(PAYMENT_KEYS), amountCents: centsSchema }))
    .min(1, 'Informe a forma de pagamento')
    .max(PAYMENT_KEYS.length)
    .refine((list) => new Set(list.map((p) => p.method)).size === list.length, {
      message: 'Forma de pagamento repetida: some os valores numa linha só',
    }),
  note: z.string().trim().max(500).default(''),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(500),
});
export type CancelSaleInput = z.infer<typeof cancelSaleSchema>;

const userRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const salePaymentSchema = z.object({ method: z.enum(PAYMENT_KEYS), amountCents: z.number().int() });
export type SalePayment = z.infer<typeof salePaymentSchema>;

export const saleItemSchema = z.object({
  productId: z.uuid(),
  /** Fotografia do produto no momento da venda (D24). */
  sku: z.string(),
  name: z.string(),
  unit: z.enum(UNIT_KEYS),
  quantity: z.number(),
  unitPriceCents: z.number().int(),
  grossCents: z.number().int(),
  discountCents: z.number().int(),
  netCents: z.number().int(),
});
export type SaleItem = z.infer<typeof saleItemSchema>;

export const saleSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(SALE_STATUSES),
  items: z.array(saleItemSchema),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
  payments: z.array(salePaymentSchema),
  receivedCents: z.number().int(),
  changeCents: z.number().int(),
  note: z.string(),
  /** Sessão de caixa em que a venda foi registrada (null nas vendas anteriores ao controle de caixa). */
  cashSessionId: z.uuid().nullable(),
  createdBy: userRefSchema,
  createdAt: z.iso.datetime(),
  canceledAt: z.iso.datetime().nullable(),
  canceledBy: userRefSchema.nullable(),
  cancelReason: z.string().nullable(),
});
export type Sale = z.infer<typeof saleSchema>;

export const saleSummarySchema = saleSchema
  .omit({ items: true, note: true, cancelReason: true, canceledBy: true, cashSessionId: true })
  .extend({ itemCount: z.number().int() });
export type SaleSummary = z.infer<typeof saleSummarySchema>;

export const saleListQuerySchema = pageQuerySchema.extend({
  status: z.enum([...SALE_STATUSES, 'ALL']).default('ALL'),
  /** Busca pelo número da venda. */
  number: z.coerce.number().int().positive().optional(),
});
export type SaleListQuery = z.infer<typeof saleListQuerySchema>;
export const salePageSchema = pageSchema(saleSummarySchema);
