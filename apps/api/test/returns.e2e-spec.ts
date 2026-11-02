import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Balance, CashSession, Product, Sale } from '@mini-erp/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, openCash, resetDatabase } from './support/test-app.js';

describe('Devolução parcial (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gerente: TestAgent;
  let vendedor: TestAgent;
  let caneta: Product; // UN, R$ 10,00
  let cafe: Product; // KG, R$ 20,00

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, 'gerente@teste.com', ['GERENTE']);
    await createUser(prisma, 'vendedor@teste.com', ['VENDEDOR']);
    gerente = await loginAs(app, 'gerente@teste.com');
    vendedor = await loginAs(app, 'vendedor@teste.com');
    await openCash(vendedor, 10000);

    caneta = (await gerente.post('/api/products').send({ sku: 'CNT', name: 'Caneta', unit: 'UN', salePriceCents: 1000 }).expect(201)).body;
    cafe = (await gerente.post('/api/products').send({ sku: 'CAF', name: 'Café', unit: 'KG', salePriceCents: 2000 }).expect(201)).body;
    for (const p of [caneta, cafe]) {
      await gerente
        .post('/api/inventory/entries')
        .set('Idempotency-Key', randomUUID())
        .send({ productId: p.id, quantity: 100, unitCostCents: 400 })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── helpers ───────────────────────────────────────────────────────────
  async function sell(items: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}): Promise<Sale> {
    return (
      await vendedor
        .post('/api/sales')
        .set('Idempotency-Key', randomUUID())
        .send({ items, payments: [{ method: 'CASH', amountCents: 1_000_000 }], ...extra })
        .expect(201)
    ).body;
  }

  const giveBack = (
    sale: Sale,
    items: { productId: string; quantity: number }[],
    extra: Record<string, unknown> = {},
    key = randomUUID(),
    agent = gerente,
  ) =>
    agent
      .post(`/api/sales/${sale.id}/returns`)
      .set('Idempotency-Key', key)
      .send({ items, reason: 'cliente trocou de ideia', refundMethod: 'PIX', ...extra });

  async function qty(productId: string): Promise<number> {
    const res = await gerente.get('/api/inventory/balances').query({ productIds: productId }).expect(200);
    return (res.body as Balance[])[0]!.quantity;
  }

  const item = (sale: Sale, productId: string) => sale.items.find((i) => i.productId === productId)!;

  // ─── básico ────────────────────────────────────────────────────────────

  it('devolve parte de um item: reembolso proporcional ao líquido (com o desconto rateado) e estoque de volta', async () => {
    // 3 × R$ 10 com 10% de desconto = R$ 27,00 líquido.
    const sale = await sell([{ productId: caneta.id, quantity: 3 }], { discount: { type: 'PERCENT', percent: 10 } });
    expect(await qty(caneta.id)).toBe(97);

    const first = (await giveBack(sale, [{ productId: caneta.id, quantity: 1 }]).expect(201)).body as Sale;
    expect(first.status).toBe('COMPLETED'); // a venda não muda: a devolução é um documento à parte
    expect(item(first, caneta.id)).toMatchObject({ returnedQuantity: 1, refundedCents: 900 });
    expect(first.returns[0]).toMatchObject({ refundCents: 900, refundMethod: 'PIX', restock: true, createdBy: { name: 'gerente' } });
    expect(await qty(caneta.id)).toBe(98);

    const kardex = await gerente.get('/api/inventory/movements').query({ productId: caneta.id }).expect(200);
    expect(kardex.body.items[0]).toMatchObject({ type: 'RETURN', quantity: 1 });

    const rest = (await giveBack(sale, [{ productId: caneta.id, quantity: 2 }]).expect(201)).body as Sale;
    expect(item(rest, caneta.id)).toMatchObject({ returnedQuantity: 3, refundedCents: 2700 });
    expect(await qty(caneta.id)).toBe(100);
  });

  it('arredondamento pelo ACUMULADO: três devoluções de 1/3 somam exatamente o que foi pago', async () => {
    // 3 × R$ 1,00 com R$ 2,00 de desconto = R$ 1,00 líquido por 3 unidades.
    const lapis = (await gerente.post('/api/products').send({ sku: 'LAP', name: 'Lápis', unit: 'UN', salePriceCents: 100 }).expect(201)).body as Product;
    await gerente.post('/api/inventory/entries').set('Idempotency-Key', randomUUID()).send({ productId: lapis.id, quantity: 3, unitCostCents: 10 }).expect(201);
    const sale = await sell([{ productId: lapis.id, quantity: 3 }], { discount: { type: 'AMOUNT', valueCents: 200 } });

    const refunds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = (await giveBack(sale, [{ productId: lapis.id, quantity: 1 }]).expect(201)).body as Sale;
      refunds.push(res.returns.at(-1)!.refundCents);
    }
    expect(refunds).toEqual([33, 34, 33]);
    expect(refunds.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('fracionado em KG', async () => {
    const sale = await sell([{ productId: cafe.id, quantity: 1.5 }]); // R$ 30,00

    const res = (await giveBack(sale, [{ productId: cafe.id, quantity: 0.25 }]).expect(201)).body as Sale;
    expect(item(res, cafe.id)).toMatchObject({ returnedQuantity: 0.25, refundedCents: 500 });
    expect(await qty(cafe.id)).toBe(98.75);
  });

  // ─── validações ────────────────────────────────────────────────────────

  it('recusa: além do vendido, produto fora da venda, fração em UN', async () => {
    const sale = await sell([{ productId: caneta.id, quantity: 2 }]);
    await giveBack(sale, [{ productId: caneta.id, quantity: 1 }]).expect(201);

    const over = await giveBack(sale, [{ productId: caneta.id, quantity: 2 }]).expect(422);
    expect(over.body).toMatchObject({ code: 'RETURN_EXCEEDS_SOLD', remaining: 1 });
    expect((await giveBack(sale, [{ productId: cafe.id, quantity: 1 }]).expect(400)).body.errors[0].path).toBe('items.0.productId');
    await giveBack(sale, [{ productId: caneta.id, quantity: 0.5 }]).expect(400);
    expect(await qty(caneta.id)).toBe(99);
  });

  it('CONCORRÊNCIA: 5 devoluções simultâneas de 1 unidade numa venda de 3 → exatamente 3 passam', async () => {
    const sale = await sell([{ productId: caneta.id, quantity: 3 }]);

    const results = await Promise.all(Array.from({ length: 5 }, () => giveBack(sale, [{ productId: caneta.id, quantity: 1 }])));

    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(2);
    expect(await qty(caneta.id)).toBe(100);
    const final = (await gerente.get(`/api/sales/${sale.id}`).expect(200)).body as Sale;
    expect(item(final, caneta.id)).toMatchObject({ returnedQuantity: 3, refundedCents: 3000 });
  });

  it('idempotente: clique duplo registra UMA devolução', async () => {
    const sale = await sell([{ productId: caneta.id, quantity: 3 }]);
    const key = randomUUID();

    const [a, b] = await Promise.all([
      giveBack(sale, [{ productId: caneta.id, quantity: 1 }], {}, key),
      giveBack(sale, [{ productId: caneta.id, quantity: 1 }], {}, key),
    ]);

    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 201]);
    expect(await prisma.saleReturn.count()).toBe(1);
    expect(await qty(caneta.id)).toBe(98);
  });

  // ─── estoque, caixa e cancelamento ─────────────────────────────────────

  it('mercadoria com defeito (restock=false): reembolsa, mas NÃO volta ao estoque', async () => {
    const sale = await sell([{ productId: caneta.id, quantity: 2 }]);

    const res = (await giveBack(sale, [{ productId: caneta.id, quantity: 1 }], { restock: false }).expect(201)).body as Sale;

    expect(res.returns[0]).toMatchObject({ restock: false, refundCents: 1000 });
    expect(await qty(caneta.id)).toBe(98);
    expect(await prisma.stockMovement.count({ where: { type: 'RETURN' } })).toBe(0);
  });

  it('reembolso em dinheiro sai da gaveta da venda (caixa ainda aberto)', async () => {
    const sale = await sell([{ productId: caneta.id, quantity: 2 }]); // entram R$ 20 na gaveta

    await giveBack(sale, [{ productId: caneta.id, quantity: 1 }], { refundMethod: 'CASH' }).expect(201);

    const session = (await gerente.get(`/api/cash/sessions/${sale.cashSessionId}`).expect(200)).body as CashSession;
    expect(session.totals!.movements.at(-1)).toMatchObject({ type: 'REFUND', amountCents: -1000, saleNumber: sale.number });
    expect(session.totals!.expectedCents).toBe(10000 + 2000 - 1000);
  });

  it('reembolso em dinheiro sem nenhuma gaveta aberta → 409 e nada é gravado', async () => {
    const sale = await sell([{ productId: caneta.id, quantity: 2 }]);
    await vendedor.post('/api/cash/current/close').send({ countedCents: 12000 }).expect(200);

    const res = await giveBack(sale, [{ productId: caneta.id, quantity: 1 }], { refundMethod: 'CASH' }).expect(409);

    expect(res.body.code).toBe('CASH_SESSION_REQUIRED');
    expect(await prisma.saleReturn.count()).toBe(0);
    expect(await qty(caneta.id)).toBe(98);
  });

  it('venda com devolução não se cancela; venda cancelada não tem devolução', async () => {
    const a = await sell([{ productId: caneta.id, quantity: 2 }]);
    await giveBack(a, [{ productId: caneta.id, quantity: 1 }]).expect(201);
    expect((await gerente.post(`/api/sales/${a.id}/cancel`).send({ reason: 'teste' }).expect(409)).body.code).toBe('SALE_HAS_RETURNS');

    const b = await sell([{ productId: caneta.id, quantity: 1 }]);
    await gerente.post(`/api/sales/${b.id}/cancel`).send({ reason: 'teste' }).expect(200);
    expect((await giveBack(b, [{ productId: caneta.id, quantity: 1 }]).expect(409)).body.code).toBe('SALE_CANCELED');
  });

  it('vendedor não registra devolução; devolução não se estorna pelo estoque', async () => {
    const sale = await sell([{ productId: caneta.id, quantity: 2 }]);
    await giveBack(sale, [{ productId: caneta.id, quantity: 1 }], {}, randomUUID(), vendedor).expect(403);

    await giveBack(sale, [{ productId: caneta.id, quantity: 1 }]).expect(201);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { type: 'RETURN' } });
    const res = await gerente
      .post(`/api/inventory/movements/${movement.id}/reverse`)
      .set('Idempotency-Key', randomUUID())
      .send({ note: 'por fora' })
      .expect(400);
    expect(res.body.code).toBe('NOT_REVERSIBLE');
  });

  // ─── banco ─────────────────────────────────────────────────────────────

  it('o banco recusa devolver além do vendido e editar uma devolução, mesmo sem a API', async () => {
    const sale = await sell([{ productId: caneta.id, quantity: 2 }]);
    await giveBack(sale, [{ productId: caneta.id, quantity: 2 }]).expect(201);
    const saleItemId = (await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } })).id;

    await expect(
      prisma.$transaction(async (tx) => {
        const r = await tx.saleReturn.create({
          data: {
            saleId: sale.id,
            reason: 'fraude',
            refundMethod: 'PIX',
            refundCents: 1000,
            restock: false,
            createdById: (await tx.user.findFirstOrThrow()).id,
          },
        });
        await tx.saleReturnItem.create({ data: { returnId: r.id, saleItemId, quantity: '1.000', refundCents: 1000 } });
      }),
    ).rejects.toThrow(/devolvido além do vendido/);

    await expect(prisma.$executeRawUnsafe(`UPDATE sale_returns SET refund_cents = 1`)).rejects.toThrow(/imutável/);
  });
});
