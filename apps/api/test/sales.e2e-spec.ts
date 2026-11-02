import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Balance, Product, Sale } from '@mini-erp/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, openCash, PAYS_WITH_PLENTY, resetDatabase } from './support/test-app.js';

describe('Vendas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gerente: TestAgent;
  let vendedor: TestAgent;
  let caneta: Product; // UN, R$ 10,00
  let lapis: Product; // UN, R$ 5,00
  let cafe: Product; // KG, R$ 19,99

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

    caneta = await product('CNT', 'Caneta', 'UN', 1000);
    lapis = await product('LAP', 'Lápis', 'UN', 500);
    cafe = await product('CAF', 'Café', 'KG', 1999);
    await stockIn(caneta.id, 100, 400);
    await stockIn(lapis.id, 100, 200);
    await stockIn(cafe.id, 10, 1200);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── helpers ───────────────────────────────────────────────────────────
  async function product(sku: string, name: string, unit: string, salePriceCents: number): Promise<Product> {
    return (await gerente.post('/api/products').send({ sku, name, unit, salePriceCents }).expect(201)).body;
  }

  async function stockIn(productId: string, quantity: number, unitCostCents: number) {
    await gerente
      .post('/api/inventory/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ productId, quantity, unitCostCents })
      .expect(201);
  }

  const sell = (
    items: { productId: string; quantity: number }[],
    extra: Record<string, unknown> = {},
    key = randomUUID(),
    agent = vendedor,
  ) => agent.post('/api/sales').set('Idempotency-Key', key).send({ items, payments: PAYS_WITH_PLENTY, ...extra });

  const pay = (...payments: [string, number][]) => ({ payments: payments.map(([method, amountCents]) => ({ method, amountCents })) });

  async function qty(productId: string): Promise<number> {
    const res = await gerente.get('/api/inventory/balances').query({ productIds: productId }).expect(200);
    return (res.body as Balance[])[0]!.quantity;
  }

  // ─── criação ───────────────────────────────────────────────────────────

  describe('criação', () => {
    it('registra a venda, baixa o estoque e numera sequencialmente', async () => {
      const res = await sell([
        { productId: caneta.id, quantity: 2 },
        { productId: lapis.id, quantity: 1 },
      ]).expect(201);
      const sale = res.body as Sale;

      expect(sale).toMatchObject({ status: 'COMPLETED', subtotalCents: 2500, discountCents: 0, totalCents: 2500 });
      expect(sale.items.map((i) => [i.sku, i.quantity, i.netCents])).toEqual([
        ['CNT', 2, 2000],
        ['LAP', 1, 500],
      ]);
      expect(await qty(caneta.id)).toBe(98);
      expect(await qty(lapis.id)).toBe(99);

      const next = (await sell([{ productId: lapis.id, quantity: 1 }]).expect(201)).body as Sale;
      expect(next.number).toBe(sale.number + 1);
    });

    it('usa o preço do catálogo e ignora preço enviado pelo cliente', async () => {
      const res = await sell([{ productId: caneta.id, quantity: 1, unitPriceCents: 1 } as never]).expect(201);

      expect(res.body.items[0].unitPriceCents).toBe(1000);
      expect(res.body.totalCents).toBe(1000);
    });

    it('fotografa nome, preço e custo médio: mudar o produto depois não altera a venda (D24)', async () => {
      const sale = (await sell([{ productId: caneta.id, quantity: 1 }]).expect(201)).body as Sale;

      await gerente.put(`/api/products/${caneta.id}`).send({ ...caneta, name: 'Caneta Nova', salePriceCents: 9999, version: 1 }).expect(200);
      await stockIn(caneta.id, 100, 1000); // muda o custo médio

      const again = (await vendedor.get(`/api/sales/${sale.id}`).expect(200)).body as Sale;
      expect(again.items[0]).toMatchObject({ name: 'Caneta', unitPriceCents: 1000 });
      const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
      expect(item.unitCostCents.toNumber()).toBe(400);
    });

    it('vende fracionado em KG e arredonda ao centavo', async () => {
      const res = await sell([{ productId: cafe.id, quantity: 0.375 }]).expect(201);

      expect(res.body.totalCents).toBe(750); // 0,375 × 19,99 = 7,49625
      expect(await qty(cafe.id)).toBe(9.625);
    });

    it('recusa fração em unidade inteira, produto arquivado e produto repetido', async () => {
      await sell([{ productId: caneta.id, quantity: 1.5 }]).expect(400);
      await sell([
        { productId: caneta.id, quantity: 1 },
        { productId: caneta.id, quantity: 1 },
      ]).expect(400);

      await gerente.post(`/api/products/${lapis.id}/archive`).expect(200);
      expect((await sell([{ productId: lapis.id, quantity: 1 }]).expect(409)).body.code).toBe('PRODUCT_ARCHIVED');
    });
  });

  describe('atomicidade (D23)', () => {
    it('se um item não tem saldo, NADA é gravado: nem venda, nem baixa dos outros itens', async () => {
      const res = await sell([
        { productId: caneta.id, quantity: 5 },
        { productId: lapis.id, quantity: 5 },
        { productId: cafe.id, quantity: 50 }, // só há 10 kg
      ]).expect(409);

      expect(res.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', productId: cafe.id, available: 10 });
      expect(await prisma.sale.count()).toBe(0);
      expect(await qty(caneta.id)).toBe(100);
      expect(await qty(lapis.id)).toBe(100);
      expect(await prisma.stockMovement.count({ where: { type: 'SALE' } })).toBe(0);
    });

    it('a venda que falhou deixa um "buraco" na numeração (D25, intencional)', async () => {
      const first = (await sell([{ productId: caneta.id, quantity: 1 }]).expect(201)).body as Sale;
      await sell([{ productId: caneta.id, quantity: 1000 }]).expect(409);
      const third = (await sell([{ productId: caneta.id, quantity: 1 }]).expect(201)).body as Sale;

      expect(third.number).toBe(first.number + 2);
    });
  });

  describe('concorrência', () => {
    it('DEADLOCK: 15 pares de vendas simultâneas [A,B] e [B,A] → todas concluem', async () => {
      const pairs = Array.from({ length: 15 }, () => [
        sell([
          { productId: caneta.id, quantity: 1 },
          { productId: lapis.id, quantity: 1 },
        ]),
        sell([
          { productId: lapis.id, quantity: 1 },
          { productId: caneta.id, quantity: 1 },
        ]),
      ]).flat();

      const results = await Promise.all(pairs);

      expect(results.map((r) => r.status)).toEqual(Array(30).fill(201));
      expect(await qty(caneta.id)).toBe(70);
      expect(await qty(lapis.id)).toBe(70);
    });

    it('10 vendas simultâneas de 1 unidade contra saldo 5 → exatamente 5 vendem', async () => {
      const ultimo = await product('ULT', 'Último lote', 'UN', 100);
      await stockIn(ultimo.id, 5, 50);

      const results = await Promise.all(Array.from({ length: 10 }, () => sell([{ productId: ultimo.id, quantity: 1 }])));

      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      expect(await qty(ultimo.id)).toBe(0);
      expect(await prisma.sale.count({ where: { items: { some: { productId: ultimo.id } } } })).toBe(5);
    });
  });

  describe('desconto (D26)', () => {
    it('rateia desconto em valor entre os itens com soma exata', async () => {
      const res = await sell(
        [
          { productId: caneta.id, quantity: 1 },
          { productId: lapis.id, quantity: 1 },
          { productId: cafe.id, quantity: 1 },
        ],
        { discount: { type: 'AMOUNT', valueCents: 100 } },
      ).expect(201);
      const sale = res.body as Sale;

      expect(sale).toMatchObject({ subtotalCents: 3499, discountCents: 100, totalCents: 3399 });
      expect(sale.items.reduce((a, i) => a + i.discountCents, 0)).toBe(100);
      expect(sale.items.reduce((a, i) => a + i.netCents, 0)).toBe(3399);
    });

    it('desconto percentual', async () => {
      const res = await sell([{ productId: caneta.id, quantity: 3 }], { discount: { type: 'PERCENT', percent: 12.5 } }).expect(201);

      expect(res.body).toMatchObject({ subtotalCents: 3000, discountCents: 375, totalCents: 2625 });
    });

    it('400 quando o desconto passa do subtotal', async () => {
      const res = await sell([{ productId: lapis.id, quantity: 1 }], { discount: { type: 'AMOUNT', valueCents: 501 } }).expect(400);

      expect(res.body.errors[0].path).toBe('discount');
    });
  });

  describe('pagamento dividido (D45)', () => {
    it('dinheiro calcula troco', async () => {
      const res = await sell([{ productId: caneta.id, quantity: 2 }], pay(['CASH', 5000])).expect(201);

      expect(res.body).toMatchObject({ totalCents: 2000, receivedCents: 5000, changeCents: 3000 });
      expect(res.body.payments).toEqual([{ method: 'CASH', amountCents: 5000 }]);
    });

    it('divide entre Pix e dinheiro; o troco sai só do dinheiro', async () => {
      // Total R$ 20: R$ 15 no Pix + nota de R$ 10 → troco de R$ 5.
      const res = await sell([{ productId: caneta.id, quantity: 2 }], pay(['PIX', 1500], ['CASH', 1000])).expect(201);

      expect(res.body).toMatchObject({ receivedCents: 2500, changeCents: 500 });
      expect(res.body.payments).toEqual([
        { method: 'CASH', amountCents: 1000 },
        { method: 'PIX', amountCents: 1500 },
      ]);
    });

    it('recusa: pago a menos, cartão acima do total (troco no cartão) e meio repetido', async () => {
      const items = [{ productId: caneta.id, quantity: 2 }];
      const short = await sell(items, pay(['CASH', 1000], ['PIX', 500])).expect(400);
      expect(short.body.errors[0]).toMatchObject({ path: 'payments', message: 'Valor pago menor que o total' });

      const over = await sell(items, pay(['CREDIT', 2500])).expect(400);
      expect(over.body.errors[0].message).toMatch(/troco só em dinheiro/);
      await sell(items, pay(['PIX', 1000], ['CASH', 2000], ['DEBIT', 0])).expect(201); // linha zerada é ignorada

      await sell(items, pay(['PIX', 1000], ['PIX', 1000])).expect(400);
      expect(await qty(caneta.id)).toBe(98);
    });

    it('o banco confere a soma dos pagamentos no COMMIT, mesmo sem a API (trigger adiado)', async () => {
      const sale = (await sell([{ productId: caneta.id, quantity: 1 }], pay(['PIX', 1000])).expect(201)).body as Sale;

      await expect(
        prisma.$executeRawUnsafe(`UPDATE sale_payments SET amount_cents = 999 WHERE sale_id = '${sale.id}'`),
      ).rejects.toThrow(/pagamentos somam 999 e o recebido é 1000/);
    });
  });

  describe('caixa (D44)', () => {
    it('sem caixa aberto não vende, e nada é gravado', async () => {
      const res = await sell([{ productId: caneta.id, quantity: 1 }], {}, randomUUID(), gerente).expect(409);

      expect(res.body.code).toBe('CASH_SESSION_REQUIRED');
      expect(await prisma.sale.count()).toBe(0);
      expect(await qty(caneta.id)).toBe(100);
    });

    it('a venda pertence ao caixa do operador e só o dinheiro líquido entra na gaveta', async () => {
      const sale = (await sell([{ productId: caneta.id, quantity: 2 }], pay(['PIX', 500], ['CASH', 2000])).expect(201)).body as Sale;

      const cash = (await gerente.get(`/api/cash/sessions/${sale.cashSessionId}`).expect(200)).body;
      expect(cash.operator.name).toBe('vendedor');
      // Nota de R$ 20 para pagar R$ 15 em dinheiro: entram R$ 15 (o troco de R$ 5 saiu da gaveta).
      expect(cash.totals.expectedCents).toBe(1500);
      expect(cash.totals.byMethod).toEqual([
        { method: 'CASH', amountCents: 1500 },
        { method: 'PIX', amountCents: 500 },
      ]);
    });
  });

  describe('idempotência', () => {
    it('clique duplo (5 envios simultâneos, mesma chave) → 1 venda e 1 baixa', async () => {
      const key = randomUUID();

      const results = await Promise.all(Array.from({ length: 5 }, () => sell([{ productId: caneta.id, quantity: 1 }], {}, key)));

      expect(new Set(results.map((r) => r.body.number)).size).toBe(1);
      expect(await prisma.sale.count()).toBe(1);
      expect(await qty(caneta.id)).toBe(99);
    });

    it('mesma chave com itens diferentes → 422', async () => {
      const key = randomUUID();
      await sell([{ productId: caneta.id, quantity: 1 }], {}, key).expect(201);

      expect((await sell([{ productId: caneta.id, quantity: 2 }], {}, key).expect(422)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('cancelamento (D27)', () => {
    it('devolve o estoque, registra quem/quando/por quê e não apaga a venda', async () => {
      const sale = (await sell([{ productId: caneta.id, quantity: 3 }]).expect(201)).body as Sale;
      expect(await qty(caneta.id)).toBe(97);

      const res = await gerente.post(`/api/sales/${sale.id}/cancel`).send({ reason: 'cliente desistiu' }).expect(200);

      expect(res.body).toMatchObject({ status: 'CANCELED', cancelReason: 'cliente desistiu', canceledBy: { name: 'gerente' } });
      expect(await qty(caneta.id)).toBe(100);
      // A saída de venda aparece como estornada no kardex.
      const kardex = await gerente.get('/api/inventory/movements').query({ productId: caneta.id }).expect(200);
      expect(kardex.body.items[0]).toMatchObject({ type: 'REVERSAL', quantity: 3 });
      expect(kardex.body.items[1]).toMatchObject({ type: 'SALE', reversedById: kardex.body.items[0].id });
    });

    it('5 cancelamentos simultâneos → só 1 devolve o estoque', async () => {
      const sale = (await sell([{ productId: caneta.id, quantity: 3 }]).expect(201)).body as Sale;

      const results = await Promise.all(
        Array.from({ length: 5 }, () => gerente.post(`/api/sales/${sale.id}/cancel`).send({ reason: 'duplicado' })),
      );

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409, 409, 409, 409]);
      expect(await qty(caneta.id)).toBe(100);
    });

    it('vendedor não cancela; saída de venda não se estorna pelo estoque', async () => {
      const sale = (await sell([{ productId: caneta.id, quantity: 1 }]).expect(201)).body as Sale;
      await vendedor.post(`/api/sales/${sale.id}/cancel`).send({ reason: 'tentativa' }).expect(403);

      const movement = await prisma.stockMovement.findFirstOrThrow({ where: { type: 'SALE' } });
      const res = await gerente
        .post(`/api/inventory/movements/${movement.id}/reverse`)
        .set('Idempotency-Key', randomUUID())
        .send({ note: 'por fora' })
        .expect(400);
      expect(res.body.code).toBe('NOT_REVERSIBLE');
    });
  });

  describe('consulta e integridade', () => {
    it('lista com filtro por número e por status', async () => {
      const a = (await sell([{ productId: caneta.id, quantity: 1 }]).expect(201)).body as Sale;
      await sell([{ productId: lapis.id, quantity: 2 }]).expect(201);
      await gerente.post(`/api/sales/${a.id}/cancel`).send({ reason: 'teste' }).expect(200);

      const byNumber = await vendedor.get('/api/sales').query({ number: a.number }).expect(200);
      const canceled = await vendedor.get('/api/sales').query({ status: 'CANCELED' }).expect(200);
      const all = await vendedor.get('/api/sales').expect(200);

      expect(byNumber.body.items).toHaveLength(1);
      expect(canceled.body.items.map((s: Sale) => s.id)).toEqual([a.id]);
      expect(all.body).toMatchObject({ total: 2 });
      expect(all.body.items[0]).toMatchObject({ itemCount: 1 });
    });

    it('o banco recusa uma venda cuja conta não fecha (CHECK)', async () => {
      const sale = (await sell([{ productId: caneta.id, quantity: 1 }]).expect(201)).body as Sale;

      // "Fraude" coerente com o troco (recebido - total = troco), para isolar a regra subtotal - desconto = total.
      await expect(
        prisma.$executeRawUnsafe(`UPDATE sales SET total_cents = 1, received_cents = 1 + change_cents WHERE id = '${sale.id}'`),
      ).rejects.toThrow(/sales_total_matches/);
    });
  });
});
