import { z } from 'zod';
import { UNIT_KEYS } from './catalog.js';

/** Fuso usado para "que dia foi esta venda" (ADR 0012, D32). */
export const REPORT_TIMEZONE = 'America/Sao_Paulo';
export const MAX_REPORT_DAYS = 366;

const isoDate = z.iso.date('Data no formato AAAA-MM-DD');

const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/**
 * Período em DATAS inclusivas (o que o usuário escolhe: "de 01/10 a 10/10").
 * A API converte para o intervalo semiaberto [01/10 00:00, 11/10 00:00) no fuso de São Paulo:
 * nada de "23:59:59" (D33).
 */
export const periodSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((p) => p.from <= p.to, { message: 'A data inicial deve ser anterior à final', path: ['from'] })
  .refine((p) => daysBetween(p.from, p.to) < MAX_REPORT_DAYS, {
    message: `Período máximo de ${MAX_REPORT_DAYS} dias`,
    path: ['to'],
  });
export type Period = z.infer<typeof periodSchema>;

const formatSchema = z.enum(['json', 'csv']).default('json');

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const salesReportQuerySchema = z
  .object({ from: isoDate, to: isoDate, granularity: z.enum(GRANULARITIES).default('day') })
  .and(periodSchema);
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;

export const marginReportQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    groupBy: z.enum(['product', 'category']).default('product'),
    format: formatSchema,
  })
  .and(periodSchema);
export type MarginReportQuery = z.infer<typeof marginReportQuerySchema>;

export const periodExportQuerySchema = z.object({ from: isoDate, to: isoDate, format: formatSchema }).and(periodSchema);
export type PeriodExportQuery = z.infer<typeof periodExportQuerySchema>;

export const staleQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(60),
  format: formatSchema,
});
export type StaleQuery = z.infer<typeof staleQuerySchema>;

export const exportQuerySchema = z.object({ format: formatSchema });
export type ExportQuery = z.infer<typeof exportQuerySchema>;

// ─── Respostas ───────────────────────────────────────────────────────────

const money = z.number().int();
/** Margem percentual sobre a receita líquida; null quando não houve receita. */
const pct = z.number().nullable();

export const salesReportSchema = z.object({
  totals: z.object({
    salesCount: z.number().int(),
    canceledCount: z.number().int(),
    grossCents: money,
    discountCents: money,
    /** Devoluções feitas no período (ADR 0019): já descontadas da receita líquida. */
    returnsCents: money,
    netCents: money,
    costCents: money,
    marginCents: money,
    marginPct: pct,
    avgTicketCents: money,
  }),
  /** Um ponto por dia/semana/mês do período, inclusive os sem venda (valor zero). */
  series: z.array(
    z.object({ bucket: isoDate, salesCount: z.number().int(), netCents: money, marginCents: money }),
  ),
});
export type SalesReport = z.infer<typeof salesReportSchema>;

export const marginRowSchema = z.object({
  /** productId ou categoryId (null = "Sem categoria"). */
  id: z.uuid().nullable(),
  sku: z.string().nullable(),
  name: z.string(),
  quantity: z.number(),
  netCents: money,
  costCents: money,
  marginCents: money,
  marginPct: pct,
});
export type MarginRow = z.infer<typeof marginRowSchema>;

export const ABC_CLASSES = ['A', 'B', 'C'] as const;
export const abcRowSchema = z.object({
  productId: z.uuid(),
  sku: z.string(),
  name: z.string(),
  netCents: money,
  sharePct: z.number(),
  cumulativePct: z.number(),
  abcClass: z.enum(ABC_CLASSES),
});
export type AbcRow = z.infer<typeof abcRowSchema>;

export const inventoryValueSchema = z.object({
  valueCents: money,
  productsWithStock: z.number().int(),
  reorderCount: z.number().int(),
});
export type InventoryValue = z.infer<typeof inventoryValueSchema>;

export const reorderRowSchema = z.object({
  productId: z.uuid(),
  sku: z.string(),
  name: z.string(),
  unit: z.enum(UNIT_KEYS),
  quantity: z.number(),
  minStock: z.number(),
  missing: z.number(),
});
export type ReorderRow = z.infer<typeof reorderRowSchema>;

export const staleRowSchema = z.object({
  productId: z.uuid(),
  sku: z.string(),
  name: z.string(),
  unit: z.enum(UNIT_KEYS),
  quantity: z.number(),
  valueCents: money,
  /** Última venda; null = nunca vendido. */
  lastSaleAt: z.iso.datetime().nullable(),
});
export type StaleRow = z.infer<typeof staleRowSchema>;

export const sellerRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  salesCount: z.number().int(),
  canceledCount: z.number().int(),
  netCents: money,
  avgTicketCents: money,
});
export type SellerRow = z.infer<typeof sellerRowSchema>;
