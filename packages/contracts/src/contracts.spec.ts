import { describe, expect, it } from 'vitest';
import { createProductSchema, quantitySchema } from './catalog.js';
import { isValidGtin } from './gtin.js';
import { centsToInput, parseBrlToCents } from './money.js';

describe('parseBrlToCents', () => {
  it.each([
    ['19,90', 1990],
    ['19,9', 1990],
    ['0,1', 10],
    ['10', 1000],
    ['1.234,56', 123456],
    ['R$ 1.234,56', 123456],
    ['1234,56', 123456],
  ])('%s -> %i centavos', (input, cents) => {
    expect(parseBrlToCents(input)).toBe(cents);
  });

  it.each(['', 'abc', '1,234', '12.34', '1.23,45', '-5', '19,999'])('rejeita %j', (input) => {
    expect(parseBrlToCents(input)).toBeNull();
  });

  it('ida e volta com centsToInput', () => {
    expect(centsToInput(123456)).toBe('1234,56');
    expect(parseBrlToCents(centsToInput(5))).toBe(5);
  });
});

describe('isValidGtin', () => {
  it.each(['7891000315507', '96385074', '036000291452', '17891000315504'])('aceita %s', (code) => {
    expect(isValidGtin(code)).toBe(true);
  });

  it.each(['7891000315508', '1234', 'abcdefghijklm', '78910003155071'])('rejeita %s', (code) => {
    expect(isValidGtin(code)).toBe(false);
  });
});

describe('quantitySchema', () => {
  it('aceita até 3 casas mesmo com imprecisão de float', () => {
    expect(quantitySchema.safeParse(2.675).success).toBe(true);
    expect(quantitySchema.safeParse(0.001).success).toBe(true);
    expect(quantitySchema.safeParse(1.0001).success).toBe(false);
  });
});

describe('createProductSchema', () => {
  const base = { sku: ' cnt-azul ', name: 'Caneta Azul', unit: 'UN', salePriceCents: 250 };

  it('normaliza SKU e aplica defaults', () => {
    const p = createProductSchema.parse({ ...base, barcode: '', categoryId: '' });
    expect(p).toMatchObject({ sku: 'CNT-AZUL', barcode: null, categoryId: null, minStock: 0, description: '' });
  });

  it('bloqueia estoque mínimo fracionado para unidade inteira', () => {
    const r = createProductSchema.safeParse({ ...base, minStock: 2.5 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['minStock']);
  });

  it('permite fracionado para KG', () => {
    expect(createProductSchema.safeParse({ ...base, unit: 'KG', minStock: 2.5 }).success).toBe(true);
  });
});
