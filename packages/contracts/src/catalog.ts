import { z } from 'zod';
import { isValidGtin } from './gtin.js';
import { centsSchema } from './money.js';
import { pageQuerySchema, pageSchema } from './pagination.js';

// ─── Unidades ──────────────────────────────────────────────────────────────

export const UNITS = {
  UN: 'Unidade',
  CX: 'Caixa',
  PC: 'Pacote',
  KG: 'Quilograma',
  L: 'Litro',
  M: 'Metro',
} as const;

export type Unit = keyof typeof UNITS;
export const UNIT_KEYS = Object.keys(UNITS) as [Unit, ...Unit[]];

/** Unidades que aceitam quantidade fracionada (2,5 kg). As demais só inteiros. */
export const FRACTIONAL_UNITS: readonly Unit[] = ['KG', 'L', 'M'];

export const isFractionalUnit = (unit: Unit) => FRACTIONAL_UNITS.includes(unit);

/** Quantidade com no máximo 3 casas decimais (gramas, mililitros, milímetros). */
export const quantitySchema = z
  .number()
  .nonnegative('Quantidade não pode ser negativa')
  .max(1_000_000_000)
  // Tolerância em vez de igualdade exata: 2.675 * 1000 = 2674.9999999999995 em float.
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'No máximo 3 casas decimais');

// ─── Categorias ────────────────────────────────────────────────────────────

export const categorySchema = z.object({ id: z.uuid(), name: z.string() });
export type Category = z.infer<typeof categorySchema>;

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(60, 'Nome muito longo'),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

// ─── Produtos ──────────────────────────────────────────────────────────────

export const PRODUCT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** SKU: código de negócio. Normalizado para maiúsculas; letras, números, - _ . */
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, 'SKU: até 40 caracteres (letras, números, - _ .)');

export const barcodeSchema = z
  .string()
  .trim()
  .refine(isValidGtin, 'Código de barras inválido (confira os dígitos)');

const productFields = z.object({
  sku: skuSchema,
  name: z.string().trim().min(2, 'Nome muito curto').max(160, 'Nome muito longo'),
  description: z.string().trim().max(1000).default(''),
  unit: z.enum(UNIT_KEYS),
  // '' vindo de um input vazio vira null: "sem código de barras".
  barcode: z.preprocess((v) => (v === '' ? null : v), barcodeSchema.nullable()).default(null),
  categoryId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()).default(null),
  salePriceCents: centsSchema,
  minStock: quantitySchema.default(0),
});

/** Regra que cruza campos: estoque mínimo fracionado só para unidades fracionáveis. */
const minStockMatchesUnit = <T extends { unit: Unit; minStock: number }>(p: T) =>
  isFractionalUnit(p.unit) || Number.isInteger(p.minStock);
const minStockIssue = {
  message: 'Esta unidade não aceita quantidade fracionada',
  path: ['minStock'],
};

export const createProductSchema = productFields.refine(minStockMatchesUnit, minStockIssue);
export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * Edição = substituição completa + a versão que o usuário viu (optimistic locking, ADR 0009).
 */
export const updateProductSchema = productFields
  .extend({ version: z.number().int().min(1) })
  .refine(minStockMatchesUnit, minStockIssue);
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string(),
  unit: z.enum(UNIT_KEYS),
  barcode: z.string().nullable(),
  category: categorySchema.nullable(),
  salePriceCents: centsSchema,
  minStock: z.number(),
  status: z.enum(PRODUCT_STATUSES),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Product = z.infer<typeof productSchema>;

export const productListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...PRODUCT_STATUSES, 'ALL']).default('ACTIVE'),
  categoryId: z.uuid().optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productPageSchema = pageSchema(productSchema);

export const updateCategorySchema = createCategorySchema;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
