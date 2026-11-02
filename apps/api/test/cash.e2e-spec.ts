import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { CashSession, Product, Sale } from '@mini-erp/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, openCash, resetDatabase } from './support/test-app.js';

describe('Caixa (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gerente: TestAgent;
  let vendedor: TestAgent;
  let estoquista: TestAgent;
  let caneta: Product; // R$ 10,00

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, 'gerente@teste.com', ['GERENTE']);
    await createUser(prisma, 'vendedor@teste.com', ['VENDEDOR']);
    await createUser(prisma, 'estoquista@teste.com', ['ESTOQUISTA']);
    gerente = await loginAs(app, 'gerente@teste.com');
    vendedor = await loginAs(app, 'vendedor@teste.com');
    estoquista = await loginAs(app, 'estoquista@teste.com');

    caneta = (
      await gerente
        .post('/api/products')
        .send({ sku: 'CNT', name: 'Caneta', unit: 'UN', salePriceCents: 1000 })
        .expect(201)
    ).body;
    await gerente
      .post('/api/inventory/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ productId: caneta.id, quantity: 1000, unitCostCents: 400 })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── helpers ───────────────────────────────────────────────────────────
  const sellCash = (agent: TestAgent, quantity: number, amountCents = quantity * 1000) =>
    agent
      .post('/api/sales')
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [{ productId: caneta.id, quantity }],
        payments: [{ method: 'CASH', amountCents }],
      });

  const move = (agent: TestAgent, type: 'SUPPLY' | 'WITHDRAWAL', amountCents: number, key = randomUUID()) =>
    agent.post('/api/cash/current/movements').set('Idempotency-Key', key).send({ type, amountCents, note: 'teste' });

  const close = (agent: TestAgent, countedCents: number) =>
    agent.post('/api/cash/current/close').send({ countedCents });

  const asGerente = async (id: string) =>
    (await gerente.get(`/api/cash/sessions/${id}`).expect(200)).body as CashSession;

  // ─── abertura ──────────────────────────────────────────────────────────

  describe('abertura', () => {
    it('abre com troco inicial; 5 cliques simultâneos abrem UM caixa só (índice único parcial)', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => vendedor.post('/api/cash/open').send({ openingCents: 10000 })),
      );

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409, 409, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe('CASH_ALREADY_OPEN');
      expect(await prisma.cashSession.count()).toBe(1);

      const current = (await vendedor.get('/api/cash/current').expect(200)).body.session as CashSession;
      expect(current).toMatchObject({
        openingCents: 10000,
        closedAt: null,
        operator: { name: 'vendedor' },
      });
    });

    it('sem caixa aberto, current responde null', async () => {
      const res = await vendedor.get('/api/cash/current').expect(200);
      expect(res.body).toEqual({ session: null });
    });
  });

  // ─── fechamento cego ───────────────────────────────────────────────────

  describe('fechamento cego (D46)', () => {
    it('o operador NÃO vê o esperado com o caixa aberto; vê depois de fechar, com a diferença', async () => {
      await openCash(vendedor, 10000); // R$ 100 de troco
      await sellCash(vendedor, 3, 5000).expect(201); // R$ 30, nota de R$ 50: entram R$ 30
      await move(vendedor, 'SUPPLY', 2000).expect(201); // +R$ 20
      await move(vendedor, 'WITHDRAWAL', 5000).expect(201); // -R$ 50

      const open = (await vendedor.get('/api/cash/current').expect(200)).body.session as CashSession;
      expect(open.totals).toBeNull();
      expect(open.salesCount).toBe(1);

      // Esperado: 100 + 30 + 20 - 50 = R$ 100. Contou R$ 98: falta de R$ 2.
      const closed = (await close(vendedor, 9800).expect(200)).body as CashSession;
      expect(closed).toMatchObject({
        countedCents: 9800,
        differenceCents: -200,
        closedBy: { name: 'vendedor' },
      });
      expect(closed.totals!.expectedCents).toBe(10000);
      expect(closed.totals!.movements.map((m) => [m.type, m.amountCents])).toEqual([
        ['OPENING', 10000],
        ['SALE', 3000],
        ['SUPPLY', 2000],
        ['WITHDRAWAL', -5000],
      ]);
    });

    it('caixa fechado não reabre, não fecha de novo e não recebe venda', async () => {
      await openCash(vendedor);
      await close(vendedor, 0).expect(200);

      expect((await close(vendedor, 0).expect(409)).body.code).toBe('CASH_SESSION_REQUIRED');
      expect((await sellCash(vendedor, 1).expect(409)).body.code).toBe('CASH_SESSION_REQUIRED');
      await openCash(vendedor); // um caixa NOVO pode ser aberto
      expect(await prisma.cashSession.count()).toBe(2);
    });

    it('CONCORRÊNCIA: vendas durante o fechamento entram ANTES (e somam no esperado) ou são recusadas', async () => {
      await openCash(vendedor);
      const sessionId = (await vendedor.get('/api/cash/current').expect(200)).body.session.id as string;

      // 20 vendas em voo; o fechamento sai assim que a primeira conclui e disputa com as demais.
      const sales = Array.from({ length: 20 }, () => sellCash(vendedor, 1).then((r) => r));
      await Promise.race(sales);
      const [closed, ...results] = await Promise.all([close(vendedor, 0), ...sales]);

      const sold = results.filter((r) => r.status === 201).map((r) => r.body as Sale);
      expect(sold.length).toBeGreaterThan(0);
      expect(results.every((r) => r.status === 201 || r.body.code === 'CASH_SESSION_REQUIRED')).toBe(true);
      // Toda venda que entrou foi nesta sessão e está no esperado gravado: nada "depois" do fechamento.
      expect(sold.every((s) => s.cashSessionId === sessionId)).toBe(true);
      expect(closed!.body.totals.expectedCents).toBe(sold.length * 1000);
      const ledger = await prisma.cashMovement.aggregate({
        where: { sessionId },
        _sum: { amountCents: true },
      });
      expect(ledger._sum.amountCents).toBe(sold.length * 1000);
    });
  });

  // ─── suprimento e sangria ──────────────────────────────────────────────

  describe('suprimento e sangria', () => {
    it('sangria maior que o dinheiro do caixa é recusada sem revelar o valor', async () => {
      await openCash(vendedor, 5000);

      const res = await move(vendedor, 'WITHDRAWAL', 5001).expect(422);
      expect(res.body).toMatchObject({ code: 'INSUFFICIENT_CASH' });
      expect(res.body.message).not.toMatch(/50/);
    });

    it('5 sangrias simultâneas de R$ 30 com R$ 100 na gaveta → só 3 passam', async () => {
      await openCash(vendedor, 10000);

      const results = await Promise.all(Array.from({ length: 5 }, () => move(vendedor, 'WITHDRAWAL', 3000)));

      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 422)).toHaveLength(2);
    });

    it('idempotente: a mesma chave não lança duas vezes; chave reaproveitada com outro valor → 422', async () => {
      await openCash(vendedor, 10000);
      const key = randomUUID();

      const [a, b] = await Promise.all([move(vendedor, 'SUPPLY', 1000, key), move(vendedor, 'SUPPLY', 1000, key)]);
      expect(a.body.id).toBe(b.body.id);
      expect(await prisma.cashMovement.count({ where: { type: 'SUPPLY' } })).toBe(1);

      expect((await move(vendedor, 'SUPPLY', 2000, key).expect(422)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('sem caixa aberto → 409', async () => {
      expect((await move(vendedor, 'SUPPLY', 1000).expect(409)).body.code).toBe('CASH_SESSION_REQUIRED');
    });
  });

  // ─── cancelamento com dinheiro (D47) ───────────────────────────────────

  describe('cancelamento devolve o dinheiro (D47)', () => {
    it('com o caixa da venda aberto, o dinheiro sai DELE (mesmo cancelando pelo gerente)', async () => {
      await openCash(vendedor);
      const sale = (await sellCash(vendedor, 2, 5000).expect(201)).body as Sale; // entram R$ 20

      await gerente.post(`/api/sales/${sale.id}/cancel`).send({ reason: 'registrado errado' }).expect(200);

      const session = await asGerente(sale.cashSessionId!);
      expect(session.totals!.expectedCents).toBe(0);
      expect(session.totals!.movements.at(-1)).toMatchObject({
        type: 'SALE_CANCEL',
        amountCents: -2000,
        saleNumber: sale.number,
      });
      expect(session.totals!.byMethod).toEqual([]); // venda cancelada não conta
    });

    it('caixa da venda já fechado: sai do caixa de quem cancela; sem caixa aberto → 409 e nada muda', async () => {
      await openCash(vendedor);
      const sale = (await sellCash(vendedor, 1).expect(201)).body as Sale;
      await close(vendedor, 1000).expect(200);

      const refused = await gerente.post(`/api/sales/${sale.id}/cancel`).send({ reason: 'cliente voltou' }).expect(409);
      expect(refused.body.code).toBe('CASH_SESSION_REQUIRED');
      expect((await gerente.get(`/api/sales/${sale.id}`).expect(200)).body.status).toBe('COMPLETED');

      await openCash(gerente, 5000);
      await gerente.post(`/api/sales/${sale.id}/cancel`).send({ reason: 'cliente voltou' }).expect(200);
      const mine = (await gerente.get('/api/cash/current').expect(200)).body.session as CashSession;
      expect(mine.totals!.expectedCents).toBe(4000);
    });

    it('venda no Pix cancela sem caixa aberto: não há dinheiro a devolver da gaveta', async () => {
      await openCash(vendedor);
      const sale = (
        await vendedor
          .post('/api/sales')
          .set('Idempotency-Key', randomUUID())
          .send({
            items: [{ productId: caneta.id, quantity: 1 }],
            payments: [{ method: 'PIX', amountCents: 1000 }],
          })
          .expect(201)
      ).body as Sale;
      await close(vendedor, 0).expect(200);

      await gerente.post(`/api/sales/${sale.id}/cancel`).send({ reason: 'estorno no Pix' }).expect(200);
    });
  });

  // ─── permissões ────────────────────────────────────────────────────────

  describe('permissões', () => {
    it('estoquista não opera caixa; vendedor não lista caixas nem vê o caixa de outro', async () => {
      await estoquista.post('/api/cash/open').send({ openingCents: 0 }).expect(403);
      await vendedor.get('/api/cash/sessions').expect(403);

      await openCash(gerente);
      const other = (await gerente.get('/api/cash/current').expect(200)).body.session.id as string;
      await vendedor.get(`/api/cash/sessions/${other}`).expect(404);
    });

    it('gerente vê o esperado do caixa aberto de outro e fecha o caixa esquecido', async () => {
      await openCash(vendedor, 3000);
      const id = (await vendedor.get('/api/cash/current').expect(200)).body.session.id as string;

      const list = (await gerente.get('/api/cash/sessions').query({ status: 'OPEN' }).expect(200)).body;
      expect(list.items[0]).toMatchObject({ id, expectedCents: 3000 });

      await vendedor.post(`/api/cash/sessions/${id}/close`).send({ countedCents: 3000 }).expect(403);
      const closed = (await gerente.post(`/api/cash/sessions/${id}/close`).send({ countedCents: 3000 }).expect(200))
        .body as CashSession;
      expect(closed).toMatchObject({
        differenceCents: 0,
        closedBy: { name: 'gerente' },
        operator: { name: 'vendedor' },
      });
    });
  });

  // ─── banco ─────────────────────────────────────────────────────────────

  describe('regras no banco', () => {
    it('livro do caixa é imutável e caixa fechado não aceita movimentação nem reabre', async () => {
      await openCash(vendedor, 1000);
      const id = (await vendedor.get('/api/cash/current').expect(200)).body.session.id as string;

      await expect(prisma.$executeRawUnsafe(`UPDATE cash_movements SET amount_cents = 1`)).rejects.toThrow(/imutável/);
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO cash_movements (id, session_id, type, amount_cents, created_by_id)
           SELECT gen_random_uuid(), id, 'WITHDRAWAL', 500, operator_id FROM cash_sessions`,
        ),
      ).rejects.toThrow(/cash_movements_sign/);

      await close(vendedor, 1000).expect(200);
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO cash_movements (id, session_id, type, amount_cents, created_by_id)
           SELECT gen_random_uuid(), id, 'SUPPLY', 500, operator_id FROM cash_sessions`,
        ),
      ).rejects.toThrow(/está fechada/);
      await expect(
        prisma.$executeRawUnsafe(`UPDATE cash_sessions SET closed_at = NULL WHERE id = '${id}'`),
      ).rejects.toThrow(/já está fechada/);
    });
  });
});
