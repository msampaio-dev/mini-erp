import { z } from 'zod';
import { pageQuerySchema, pageSchema } from './pagination.js';

/** Pesos do dígito verificador: CNPJ começa em 5 (e depois 6), recomeçando em 9 → 2. */
function cnpjDigit(digits: number[]): number {
  const weights = digits.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const rest = digits.reduce((acc, d, i) => acc + d * weights[i]!, 0) % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** CNPJ (14 dígitos) pelos dois dígitos verificadores. Sequências repetidas (000...0) são inválidas. */
export function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const d = [...value].map(Number);
  return cnpjDigit(d.slice(0, 12)) === d[12] && cnpjDigit(d.slice(0, 13)) === d[13];
}

/** CPF (11 dígitos): pesos 10 → 2 e 11 → 2. Produtor rural e pessoa física também fornecem. */
export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  const digit = (n: number) => {
    const sum = d.slice(0, n).reduce((acc, x, i) => acc + x * (n + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === d[9] && digit(10) === d[10];
}

/** "12.345.678/0001-95" → "12345678000195": guardado só com dígitos, formatado na tela. */
export const documentSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => isValidCnpj(v) || isValidCpf(v), 'CNPJ ou CPF inválido (confira os dígitos)');

export function formatDocument(digits: string): string {
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return digits;
}

const optionalText = (max: number) => z.string().trim().max(max).default('');

export const supplierInputSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(160),
  document: z.preprocess((v) => (v === '' ? null : v), documentSchema.nullable()).default(null),
  phone: optionalText(40),
  email: z
    .preprocess((v) => (v === '' ? undefined : v), z.email('E-mail inválido').optional())
    .transform((v) => v ?? ''),
  note: optionalText(1000),
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;

export const supplierSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  document: z.string().nullable(),
  phone: z.string(),
  email: z.string(),
  note: z.string(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Supplier = z.infer<typeof supplierSchema>;

export const supplierListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
});
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;
export const supplierPageSchema = pageSchema(supplierSchema);

/** Referência curta do fornecedor numa movimentação de estoque. */
export const supplierRefSchema = z.object({ id: z.uuid(), name: z.string() });
