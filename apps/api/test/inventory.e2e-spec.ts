import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Balance, Movement, Product } from '@mini-erp/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, resetDatabase } from './support/test-app.js';

describe('Estoque (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gerente: TestAgent;
  let estoquista: TestAgent;
  let vendedor: TestAgent;
  let caneta: Product;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, 'gerente@teste.com', ['GERENTE']);
    await createUser(prisma, 'estoquista@teste.com', ['ESTOQUISTA']);
    await createUser(prisma, 'vendedor@teste.com', ['VENDEDOR']);
    gerente = await loginAs(app, 'gerente@teste.com');
    estoquista = await loginAs(app, 'estoquista@teste.com');
    vendedor = await loginAs(app, 'vendedor@teste.com');
    caneta = (
      await gerente
        .post('/api/products')
        .send({ sku: 'CNT', name: 'Caneta', unit: 'UN', salePriceCents: 250 })
        .expect(201)
    ).body as Product;
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── helpers ───────────────────────────────────────────────────────────
  const entry = (agent: TestAgent, quantity: number, unitCostCents: number, key = randomUUID(), productId = caneta.id) =>
    agent.post('/api/inventory/entries').set('Idempotency-Key', key).send({ productId, quantity, unitCostCents });

  const adjust = (agent: TestAgent, quantity: number, reason = 'AVARIA', key = randomUUID()) =>
    agent.post('/api/inventory/adjustments').set('Idempotency-Key', key).send({ productId: caneta.id, quantity, reason });

  const reverse = (agent: TestAgent, movementId: string, key = randomUUID()) =>
    agent.post(`/api/inventory/movements/${movementId}/reverse`).set('Idempotency-Key', key).send({ note: 'lançado errado' });

  async function balance(productId = caneta.id): Promise<Balance> {
    const res = await gerente.get('/api/inventory/balances').query({ productIds: productId }).expect(200);
    return (res.body as Balance[])[0]!;
  }

  // ─── testes ────────────────────────────────────────────────────────────

  describe('entradas e custo médio (D20)', () => {
    it('produto sem movimentação tem saldo zero', async () => {
      expect(await balance()).toEqual({ productId: caneta.id, quantity: 0, avgCostCents: 0, totalValueCents: 0 });
    });

    it('calcula o custo médio ponderado: 10 a R$2,00 + 10 a R$3,00 = R$2,50', async () => {
      await entry(estoquista, 10, 200).expect(201);
      const res = await entry(estoquista, 10, 300).expect(201);

      expect(res.body).toMatchObject({ type: 'ENTRY', quantity: 10, unitCostCents: 300, balanceAfter: 20 });
      expect(await balance()).toEqual({ productId: caneta.id, quantity: 20, avgCostCents: 250, totalValueCents: 5000 });
    });

    it('pondera pela quantidade, não pela média simples: 30 a R$1,00 + 10 a R$5,00 = R$2,00', async () => {
      await entry(estoquista, 30, 100).expect(201);
      await entry(estoquista, 10, 500).expect(201);

      expect((await balance()).avgCostCents).toBe(200);
    });
  });

  describe('saídas e saldo nunca negativo (D18)', () => {
    it('ajuste negativo baixa o saldo sem mudar o custo médio', async () => {
      await entry(estoquista, 10, 200).expect(201);

      const res = await adjust(gerente, -3).expect(201);

      expect(res.body).toMatchObject({ type: 'ADJUSTMENT', quantity: -3, reason: 'AVARIA', balanceAfter: 7 });
      expect(await balance()).toMatchObject({ quantity: 7, avgCostCents: 200 });
    });

    it('409 INSUFFICIENT_STOCK informando o disponível', async () => {
      await entry(estoquista, 2, 200).expect(201);

      const res = await adjust(gerente, -5).expect(409);

      expect(res.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', available: 2 });
      expect((await balance()).quantity).toBe(2);
    });

    it('CONCORRÊNCIA: 20 saídas simultâneas de 1 contra saldo 10 → exatamente 10 passam', async () => {
      await entry(estoquista, 10, 200).expect(201);

      const results = await Promise.all(Array.from({ length: 20 }, () => adjust(gerente, -1)));

      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(10);
      expect(statuses.filter((s) => s === 409)).toHaveLength(10);
      expect((await balance()).quantity).toBe(0);

      // Cada saída bem-sucedida registrou um saldo diferente: 9, 8, ..., 0 (nenhuma "viu" o mesmo saldo).
      const after = results.filter((r) => r.status === 201).map((r) => (r.body as Movement).balanceAfter);
      expect(after.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('CONCORRÊNCIA: 10 entradas simultâneas com custos diferentes → custo médio exato', async () => {
      const costs = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

      await Promise.all(costs.map((c) => entry(estoquista, 1, c).expect(201)));

      const b = await balance();
      expect(b.quantity).toBe(10);
      expect(b.avgCostCents).toBeCloseTo(550, 2);
    });
  });

  describe('regras de negócio', () => {
    it('unidade inteira não aceita quantidade fracionada; KG aceita', async () => {
      const res = await entry(estoquista, 2.5, 100).expect(400);
      expect(res.body.errors[0].path).toBe('quantity');

      const arroz = (
        await gerente.post('/api/products').send({ sku: 'ARZ', name: 'Arroz', unit: 'KG', salePriceCents: 800 }).expect(201)
      ).body as Product;
      await entry(estoquista, 2.5, 600, randomUUID(), arroz.id).expect(201);
      expect((await balance(arroz.id)).quantity).toBe(2.5);
    });

    it('produto arquivado não movimenta', async () => {
      await gerente.post(`/api/products/${caneta.id}/archive`).expect(200);

      const res = await entry(estoquista, 1, 100).expect(409);
      expect(res.body.code).toBe('PRODUCT_ARCHIVED');
    });

    it('400 sem Idempotency-Key', async () => {
      const res = await estoquista
        .post('/api/inventory/entries')
        .send({ productId: caneta.id, quantity: 1, unitCostCents: 100 })
        .expect(400);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });
  });

  describe('estornos (D19)', () => {
    it('estorna uma entrada: saldo e custo médio voltam ao que eram', async () => {
      await entry(estoquista, 10, 200).expect(201);
      const errada = (await entry(estoquista, 10, 400).expect(201)).body as Movement;
      expect((await balance()).avgCostCents).toBe(300);

      const res = await reverse(gerente, errada.id).expect(201);

      expect(res.body).toMatchObject({ type: 'REVERSAL', quantity: -10, reversalOfId: errada.id, balanceAfter: 10 });
      expect(await balance()).toMatchObject({ quantity: 10, avgCostCents: 200 });
    });

    it('estorna um ajuste negativo devolvendo a quantidade', async () => {
      await entry(estoquista, 10, 200).expect(201);
      const avaria = (await adjust(gerente, -4).expect(201)).body as Movement;

      await reverse(gerente, avaria.id).expect(201);

      expect((await balance()).quantity).toBe(10);
    });

    it('não estorna duas vezes, nem estorna um estorno', async () => {
      await entry(estoquista, 10, 200).expect(201);
      const m = (await adjust(gerente, -1).expect(201)).body as Movement;
      const estorno = (await reverse(gerente, m.id).expect(201)).body as Movement;

      expect((await reverse(gerente, m.id).expect(409)).body.code).toBe('ALREADY_REVERSED');
      expect((await reverse(gerente, estorno.id).expect(400)).body.code).toBe('NOT_REVERSIBLE');
    });

    it('CONCORRÊNCIA: 5 estornos simultâneos da mesma movimentação → só 1 passa', async () => {
      await entry(estoquista, 10, 200).expect(201);
      const m = (await adjust(gerente, -2).expect(201)).body as Movement;

      const results = await Promise.all(Array.from({ length: 5 }, () => reverse(gerente, m.id)));

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409, 409, 409]);
      expect((await balance()).quantity).toBe(10);
    });

    it('não estorna entrada cuja mercadoria já saiu', async () => {
      const compra = (await entry(estoquista, 5, 200).expect(201)).body as Movement;
      await adjust(gerente, -5).expect(201);

      const res = await reverse(gerente, compra.id).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    });

    it('o kardex mostra a original marcada como estornada', async () => {
      const m = (await entry(estoquista, 3, 200).expect(201)).body as Movement;
      const estorno = (await reverse(gerente, m.id).expect(201)).body as Movement;

      const res = await gerente.get('/api/inventory/movements').query({ productId: caneta.id }).expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items[0]).toMatchObject({ id: estorno.id, balanceAfter: 0 });
      expect(res.body.items[1]).toMatchObject({ id: m.id, reversedById: estorno.id });
    });
  });

  describe('idempotência (D21)', () => {
    it('repetir a mesma chave não lança de novo: 200 + Idempotent-Replayed', async () => {
      const key = randomUUID();
      const first = await entry(estoquista, 5, 200, key).expect(201);
      const again = await entry(estoquista, 5, 200, key).expect(200);

      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.id).toBe(first.body.id);
      expect((await balance()).quantity).toBe(5);
    });

    it('CONCORRÊNCIA: 5 envios simultâneos com a mesma chave → 1 lançamento', async () => {
      const key = randomUUID();

      const results = await Promise.all(Array.from({ length: 5 }, () => entry(estoquista, 5, 200, key)));

      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect((await balance()).quantity).toBe(5);
      expect(await prisma.stockMovement.count()).toBe(1);
    });

    it('mesma chave com dados diferentes → 422', async () => {
      const key = randomUUID();
      await entry(estoquista, 5, 200, key).expect(201);

      const res = await entry(estoquista, 6, 200, key).expect(422);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('a chave é por usuário: outro usuário com a mesma chave lança normalmente', async () => {
      const key = randomUUID();
      await entry(estoquista, 1, 200, key).expect(201);
      await entry(gerente, 1, 200, key).expect(201);

      expect((await balance()).quantity).toBe(2);
    });
  });

  describe('permissões', () => {
    it('vendedor consulta; estoquista lança entrada mas não ajusta', async () => {
      await vendedor.get('/api/inventory/balances').query({ productIds: caneta.id }).expect(200);
      await vendedor.get('/api/inventory/movements').query({ productId: caneta.id }).expect(200);
      await entry(vendedor, 1, 100).expect(403);
      await adjust(estoquista, 1).expect(403);
    });
  });

  describe('livro-razão imutável no banco (D17)', () => {
    it('UPDATE e DELETE em stock_movements são bloqueados pelo trigger', async () => {
      await entry(estoquista, 1, 100).expect(201);

      await expect(prisma.$executeRawUnsafe('UPDATE stock_movements SET quantity = 999')).rejects.toThrow(/imutável/);
      await expect(prisma.$executeRawUnsafe('DELETE FROM stock_movements')).rejects.toThrow(/imutável/);
      expect(await prisma.stockMovement.count()).toBe(1);
    });

    it('o banco recusa saldo negativo mesmo via SQL direto', async () => {
      await entry(estoquista, 1, 100).expect(201);

      await expect(
        prisma.$executeRawUnsafe(`UPDATE stock_balances SET quantity = -1 WHERE product_id = '${caneta.id}'`),
      ).rejects.toThrow(/stock_balances_quantity_nonnegative/);
    });
  });
});
