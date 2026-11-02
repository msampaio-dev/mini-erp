import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { AbcRow, MarginRow, Product, ReorderRow, Sale, SalesReport, SellerRow, StaleRow } from '@mini-erp/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, openCash, PAYS_WITH_PLENTY, resetDatabase } from './support/test-app.js';

describe('Relatórios (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gerente: TestAgent;
  let vendedor: TestAgent;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, 'gerente@teste.com', ['GERENTE']);
    await createUser(prisma, 'vendedor@teste.com', ['VENDEDOR']);
    gerente = await loginAs(app, 'gerente@teste.com');
    vendedor = await loginAs(app, 'vendedor@teste.com');
    await openCash(vendedor);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── helpers ───────────────────────────────────────────────────────────
  async function product(data: Record<string, unknown>): Promise<Product> {
    return (await gerente.post('/api/products').send(data).expect(201)).body;
  }
  async function stockIn(productId: string, quantity: number, unitCostCents: number) {
    await gerente.post('/api/inventory/entries').set('Idempotency-Key', randomUUID()).send({ productId, quantity, unitCostCents }).expect(201);
  }
  async function sell(items: { productId: string; quantity: number }[], at?: string): Promise<Sale> {
    const sale = (
      await vendedor.post('/api/sales').set('Idempotency-Key', randomUUID()).send({ items, payments: PAYS_WITH_PLENTY }).expect(201)
    ).body as Sale;
    // A tabela de vendas não é imutável (só o livro-razão é): dá para posicionar a venda no tempo.
    if (at) await prisma.$executeRawUnsafe(`UPDATE sales SET created_at = $1::timestamptz WHERE id = $2::uuid`, at, sale.id);
    return sale;
  }
  const report = <T>(path: string, query: Record<string, string | number> = {}) =>
    gerente.get(`/api/reports/${path}`).query(query).expect(200).then((r) => r.body as T);

  /** Cenário com vendas nas "bordas" do dia em São Paulo. */
  async function scenario() {
    const papelaria = (await gerente.post('/api/categories').send({ name: 'Papelaria' }).expect(201)).body;
    const caneta = await product({ sku: 'CNT', name: 'Caneta', unit: 'UN', salePriceCents: 1000, categoryId: papelaria.id });
    const lapis = await product({ sku: 'LAP', name: 'Lápis', unit: 'UN', salePriceCents: 500, categoryId: papelaria.id });
    const cafe = await product({ sku: 'CAF', name: 'Café', unit: 'KG', salePriceCents: 1999 });
    await stockIn(caneta.id, 100, 400);
    await stockIn(lapis.id, 100, 200);
    await stockIn(cafe.id, 10, 1200);

    // 10/10 22:30 em SP = 11/10 01:30 UTC  -> deve contar no dia 10
    await sell([{ productId: caneta.id, quantity: 2 }], '2026-10-11T01:30:00Z');
    // 09/10 23:59:59.999 em SP = 10/10 02:59:59.999 UTC -> deve contar no dia 09.
    // Valor DIFERENTE da venda de 22:30 de propósito: com valores iguais, um agrupamento
    // errado por UTC trocaria uma pela outra e o total bateria por coincidência.
    await sell([{ productId: lapis.id, quantity: 3 }], '2026-10-10T02:59:59.999Z');
    // 10/10 12:00 em SP
    await sell([{ productId: cafe.id, quantity: 1 }], '2026-10-10T15:00:00Z');
    // cancelada no dia 10: não entra na receita, só na contagem de canceladas
    const cancelada = await sell([{ productId: caneta.id, quantity: 1 }], '2026-10-10T18:00:00Z');
    await gerente.post(`/api/sales/${cancelada.id}/cancel`).send({ reason: 'teste' }).expect(200);
    return { caneta, lapis, cafe };
  }

  // ─── testes ────────────────────────────────────────────────────────────

  describe('vendas por período', () => {
    it('agrupa pelo dia de SÃO PAULO, não de UTC (D32), e usa intervalo semiaberto (D33)', async () => {
      await scenario();

      const dia10 = await report<SalesReport>('sales', { from: '2026-10-10', to: '2026-10-10' });

      // Entram: 22:30 do dia 10 (UTC já é dia 11) e o café. Fica fora: 23:59:59.999 do dia 09.
      expect(dia10.totals).toEqual({
        salesCount: 2,
        canceledCount: 1,
        grossCents: 3999,
        discountCents: 0,
        netCents: 3999,
        costCents: 2000,
        marginCents: 1999,
        marginPct: 49.99,
        avgTicketCents: 2000,
      });
    });

    it('série preenche dias sem venda com zero', async () => {
      await scenario();

      const r = await report<SalesReport>('sales', { from: '2026-10-08', to: '2026-10-10' });

      expect(r.series).toEqual([
        { bucket: '2026-10-08', salesCount: 0, netCents: 0, marginCents: 0 },
        { bucket: '2026-10-09', salesCount: 1, netCents: 1500, marginCents: 900 },
        { bucket: '2026-10-10', salesCount: 2, netCents: 3999, marginCents: 1999 },
      ]);
    });

    it('agrupa por mês', async () => {
      await scenario();

      const r = await report<SalesReport>('sales', { from: '2026-09-01', to: '2026-10-31', granularity: 'month' });

      expect(r.series.map((p) => [p.bucket, p.salesCount])).toEqual([
        ['2026-09-01', 0],
        ['2026-10-01', 3],
      ]);
    });

    it('valida o período', async () => {
      await gerente.get('/api/reports/sales').query({ from: '2026-10-10', to: '2026-10-01' }).expect(400);
      await gerente.get('/api/reports/sales').query({ from: '2024-01-01', to: '2026-10-01' }).expect(400);
    });
  });

  describe('margem', () => {
    it('por produto: receita - custo fotografado na venda; canceladas fora', async () => {
      await scenario();

      const rows = await report<MarginRow[]>('margin', { from: '2026-10-09', to: '2026-10-10' });

      expect(rows.map((r) => [r.sku, r.quantity, r.netCents, r.costCents, r.marginCents, r.marginPct])).toEqual([
        ['CNT', 2, 2000, 800, 1200, 60],
        ['LAP', 3, 1500, 600, 900, 60],
        ['CAF', 1, 1999, 1200, 799, 39.97],
      ]);
    });

    it('por categoria, com "Sem categoria"', async () => {
      await scenario();

      const rows = await report<MarginRow[]>('margin', { from: '2026-10-09', to: '2026-10-10', groupBy: 'category' });

      expect(rows.map((r) => [r.name, r.netCents, r.marginCents])).toEqual([
        ['Papelaria', 3500, 2100],
        ['Sem categoria', 1999, 799],
      ]);
    });
  });

  it('curva ABC: classifica pelo acumulado antes do item (80% / 95%)', async () => {
    const precos = { X: 9000, Y: 800, Z: 150, W: 50 };
    for (const [sku, price] of Object.entries(precos)) {
      const p = await product({ sku, name: `Produto ${sku}`, unit: 'UN', salePriceCents: price });
      await stockIn(p.id, 1, 1);
      await sell([{ productId: p.id, quantity: 1 }], '2026-10-10T15:00:00Z');
    }

    const rows = await report<AbcRow[]>('abc', { from: '2026-10-10', to: '2026-10-10' });

    // X: acumulado antes 0% -> A | Y: 90% -> B | Z: 98% -> C | W: 99,5% -> C
    expect(rows.map((r) => [r.sku, r.sharePct, r.cumulativePct, r.abcClass])).toEqual([
      ['X', 90, 90, 'A'],
      ['Y', 8, 98, 'B'],
      ['Z', 1.5, 99.5, 'C'],
      ['W', 0.5, 100, 'C'],
    ]);
  });

  describe('estoque', () => {
    it('valor do estoque, reposição e produtos parados', async () => {
      const borracha = await product({ sku: 'BOR', name: 'Borracha', unit: 'UN', salePriceCents: 100, minStock: 10 });
      const parado = await product({ sku: 'PAR', name: 'Parado', unit: 'UN', salePriceCents: 100 });
      const antigo = await product({ sku: 'ANT', name: 'Vendido há tempo', unit: 'UN', salePriceCents: 100 });
      const recente = await product({ sku: 'REC', name: 'Vendido agora', unit: 'UN', salePriceCents: 100 });
      await stockIn(borracha.id, 3, 50); // 3 < mínimo 10
      await stockIn(parado.id, 5, 200); // nunca vendido
      await stockIn(antigo.id, 5, 100);
      await stockIn(recente.id, 5, 100);
      const old = await sell([{ productId: antigo.id, quantity: 1 }]);
      await prisma.$executeRawUnsafe(`UPDATE sales SET created_at = now() - interval '100 days' WHERE id = $1::uuid`, old.id);
      await sell([{ productId: recente.id, quantity: 1 }]);

      const value = await report<{ valueCents: number; productsWithStock: number; reorderCount: number }>('inventory');
      expect(value).toEqual({ valueCents: 3 * 50 + 5 * 200 + 4 * 100 + 4 * 100, productsWithStock: 4, reorderCount: 1 });

      const reorder = await report<ReorderRow[]>('reorder');
      expect(reorder).toEqual([
        { productId: borracha.id, sku: 'BOR', name: 'Borracha', unit: 'UN', quantity: 3, minStock: 10, missing: 7 },
      ]);

      const stale = await report<StaleRow[]>('stale', { days: 60 });
      expect(stale.map((r) => [r.sku, r.valueCents, r.lastSaleAt === null])).toEqual([
        ['PAR', 1000, true],
        ['ANT', 400, false],
        ['BOR', 150, true],
      ]);
    });
  });

  it('desempenho por vendedor', async () => {
    await scenario();

    const rows = await report<SellerRow[]>('sellers', { from: '2026-10-09', to: '2026-10-10' });

    expect(rows).toEqual([
      expect.objectContaining({ name: 'vendedor', salesCount: 3, canceledCount: 1, netCents: 5499, avgTicketCents: 1833 }),
    ]);
  });

  describe('exportação CSV (D34)', () => {
    it('BOM, separador ";", vírgula decimal e nome de arquivo com o período', async () => {
      await scenario();

      const res = await gerente
        .get('/api/reports/margin')
        .query({ from: '2026-10-09', to: '2026-10-10', format: 'csv' })
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => (data += chunk));
          r.on('end', () => cb(null, data));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('margem_por_produto_2026-10-09_a_2026-10-10.csv');
      const text = res.body as string;
      expect(text.startsWith('﻿')).toBe(true);
      const lines = text.slice(1).trim().split('\r\n');
      expect(lines[0]).toBe('SKU;Produto;Quantidade;Receita líquida (R$);Custo (R$);Margem (R$);Margem (%)');
      expect(lines[3]).toBe('CAF;Café;1;19,99;12,00;7,99;39,97');
    });
  });

  it('só quem tem relatorios:ler acessa', async () => {
    await vendedor.get('/api/reports/sales').query({ from: '2026-10-10', to: '2026-10-10' }).expect(403);
    await vendedor.get('/api/reports/reorder').expect(403);
  });
});
