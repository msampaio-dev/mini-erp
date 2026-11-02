import { describe, expect, it } from 'vitest';
import { createProductSchema, quantitySchema } from './catalog.js';
import { isValidGtin } from './gtin.js';
import { centsToInput, parseBrlToCents } from './money.js';
import { balancesQuerySchema, createAdjustmentSchema, createEntrySchema } from './inventory.js';
import { periodSchema } from './reports.js';
import { parseScaleLabel, scaleQuantity } from './store.js';
import { documentSchema, formatDocument, isValidCnpj, isValidCpf } from './suppliers.js';

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

describe('contratos de estoque', () => {
  const productId = '0199a6a0-0000-7000-8000-000000000000';

  it('entrada exige quantidade positiva', () => {
    expect(createEntrySchema.safeParse({ productId, quantity: -1, unitCostCents: 100 }).success).toBe(false);
    expect(createEntrySchema.safeParse({ productId, quantity: 0, unitCostCents: 100 }).success).toBe(false);
    expect(createEntrySchema.safeParse({ productId, quantity: 2.5, unitCostCents: 100 }).success).toBe(true);
  });

  it('ajuste aceita sinal, mas motivo OUTRO exige descrição', () => {
    expect(createAdjustmentSchema.safeParse({ productId, quantity: -3, reason: 'AVARIA' }).success).toBe(true);
    const semNota = createAdjustmentSchema.safeParse({ productId, quantity: 1, reason: 'OUTRO' });
    expect(semNota.success).toBe(false);
    expect(semNota.error?.issues[0]?.path).toEqual(['note']);
  });

  it('lista de ids de produto vem separada por vírgula', () => {
    expect(balancesQuerySchema.parse({ productIds: `${productId},${productId}` }).productIds).toHaveLength(2);
    expect(balancesQuerySchema.safeParse({ productIds: 'x' }).success).toBe(false);
  });
});

describe('contratos de relatórios', () => {
  it('período: data inicial não pode passar da final', () => {
    expect(periodSchema.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success).toBe(false);
    expect(periodSchema.safeParse({ from: '2026-10-01', to: '2026-10-01' }).success).toBe(true);
  });

  it('período: no máximo 366 dias', () => {
    expect(periodSchema.safeParse({ from: '2025-10-10', to: '2026-10-10' }).success).toBe(true); // 365
    expect(periodSchema.safeParse({ from: '2024-10-10', to: '2026-10-10' }).success).toBe(false);
  });

  it('rejeita data inválida', () => {
    expect(periodSchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(periodSchema.safeParse({ from: '10/10/2026', to: '2026-10-10' }).success).toBe(false);
  });
});

describe('etiqueta de balança (ADR 0020)', () => {
  // 2 | 000123 | 01235 | DV: produto 000123, valor 01235
  const label = (body: string) => {
    const sum = [...body].reverse().reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
    return body + ((10 - (sum % 10)) % 10);
  };

  it('lê código e valor; recusa prefixo diferente de 2 e dígito verificador errado', () => {
    const code = label('200012301235');
    expect(parseScaleLabel(code)).toEqual({ scaleCode: '000123', value: 1235 });
    expect(parseScaleLabel('7' + code.slice(1))).toBeNull();
    expect(parseScaleLabel(code.slice(0, 12) + ((Number(code[12]) + 1) % 10))).toBeNull();
    expect(parseScaleLabel('2000123')).toBeNull();
  });

  it('peso em gramas vira kg exato; preço vira kg pelo preço por quilo', () => {
    const l = { scaleCode: '000123', value: 1235 };
    expect(scaleQuantity(l, 'WEIGHT', 699)).toBe(1.235);
    // R$ 12,35 de banana a R$ 6,99/kg = 1,7668... kg → 1,767 kg
    expect(scaleQuantity(l, 'PRICE', 699)).toBe(1.767);
  });

  it('código de balança: até 6 dígitos, completado com zeros; só para KG', () => {
    const base = { sku: 'BAN', name: 'Banana', unit: 'KG', salePriceCents: 699 };
    expect(createProductSchema.parse({ ...base, scaleCode: '42' }).scaleCode).toBe('000042');
    expect(createProductSchema.parse({ ...base, scaleCode: '' }).scaleCode).toBeNull();
    expect(createProductSchema.safeParse({ ...base, unit: 'UN', scaleCode: '42' }).success).toBe(false);
  });
});

describe('CNPJ e CPF (ADR 0021)', () => {
  it('valida pelos dígitos verificadores e recusa sequências repetidas', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
  });

  it('o schema tira a máscara; a tela formata de volta', () => {
    expect(documentSchema.parse('11.222.333/0001-81')).toBe('11222333000181');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
  });
});

