import { describe, expect, it } from 'vitest';
import { allocateProportionally, computeSaleTotals, discountCents, lineGrossCents } from './sale-math.js';
import { createSaleSchema } from './sales.js';

describe('lineGrossCents', () => {
  it('quantidade inteira', () => {
    expect(lineGrossCents(3, 250)).toBe(750);
  });

  it('quantidade fracionada arredonda ao centavo (metade para cima)', () => {
    expect(lineGrossCents(0.375, 1999)).toBe(750); // 749,625 -> 750
    expect(lineGrossCents(0.5, 1)).toBe(1); // 0,5 -> 1
  });

  it('não perde precisão com valores grandes (BigInt)', () => {
    // 99.999,999 × R$ 10.000.000,00 passaria de 2^53 com number
    expect(lineGrossCents(99_999.999, 1_000_000_000)).toBe(99_999_999_000_000);
  });
});

describe('allocateProportionally (maior resto)', () => {
  it('soma sempre exata: R$ 0,10 entre 3 linhas iguais -> 4,3,3', () => {
    expect(allocateProportionally(10, [100, 100, 100])).toEqual([4, 3, 3]);
  });

  it('proporcional aos pesos', () => {
    expect(allocateProportionally(100, [300, 100])).toEqual([75, 25]);
  });

  it('sobra vai para o maior resto, não para a primeira linha', () => {
    // fatias: 1,428 / 2,857 / 5,714 -> pisos 1, 2, 5 (soma 8); sobram 2 centavos,
    // que vão para os maiores restos: 0,857 (2ª linha) e 0,714 (3ª linha).
    expect(allocateProportionally(10, [1, 2, 4])).toEqual([1, 3, 6]);
  });

  it('a soma bate em 1.000 casos aleatórios', () => {
    for (let i = 0; i < 1000; i++) {
      const weights = Array.from({ length: 1 + (i % 7) }, (_, j) => ((i * 7919 + j * 104729) % 100_000) + 1);
      const total = (i * 31337) % 50_000;
      const parts = allocateProportionally(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
  });
});

describe('discountCents', () => {
  it('percentual com 2 casas', () => {
    expect(discountCents(1000, { type: 'PERCENT', percent: 12.5 })).toBe(125);
    expect(discountCents(999, { type: 'PERCENT', percent: 10 })).toBe(100); // 99,9 -> 100
  });

  it('valor fixo', () => {
    expect(discountCents(1000, { type: 'AMOUNT', valueCents: 300 })).toBe(300);
  });
});

describe('computeSaleTotals', () => {
  it('rateia o desconto entre as linhas e fecha o total', () => {
    const t = computeSaleTotals(
      [
        { quantity: 1, unitPriceCents: 1000 },
        { quantity: 2, unitPriceCents: 500 },
        { quantity: 1, unitPriceCents: 333 },
      ],
      { type: 'AMOUNT', valueCents: 100 },
    );

    expect(t.subtotalCents).toBe(2333);
    expect(t.totalCents).toBe(2233);
    expect(t.lines.reduce((a, l) => a + l.discountCents, 0)).toBe(100);
    expect(t.lines.reduce((a, l) => a + l.netCents, 0)).toBe(t.totalCents);
  });

  it('recusa desconto maior que o subtotal', () => {
    expect(() => computeSaleTotals([{ quantity: 1, unitPriceCents: 100 }], { type: 'AMOUNT', valueCents: 101 })).toThrow(
      RangeError,
    );
  });
});

describe('createSaleSchema', () => {
  const productId = '0199a6a0-0000-7000-8000-000000000000';

  it('não aceita o mesmo produto em duas linhas', () => {
    const r = createSaleSchema.safeParse({
      items: [
        { productId, quantity: 1 },
        { productId, quantity: 2 },
      ],
      payment: { method: 'PIX' },
    });
    expect(r.success).toBe(false);
  });

  it('ignora qualquer preço enviado pelo cliente', () => {
    const r = createSaleSchema.parse({
      items: [{ productId, quantity: 1, unitPriceCents: 1 }],
      payment: { method: 'PIX' },
    });
    expect(r.items[0]).not.toHaveProperty('unitPriceCents');
  });
});
