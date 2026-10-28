import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { MarginRow, Product } from '@mini-erp/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, resetDatabase } from './support/test-app.js';

describe('Histórico de categoria e trava de unidade (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gerente: TestAgent;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, 'gerente@teste.com', ['GERENTE']);
    gerente = await loginAs(app, 'gerente@teste.com');
  });

  afterAll(async () => {
    await app.close();
  });

  const category = async (name: string) => (await gerente.post('/api/categories').send({ name }).expect(201)).body.id as string;
  const stockIn = (productId: string, quantity: number) =>
    gerente.post('/api/inventory/entries').set('Idempotency-Key', randomUUID()).send({ productId, quantity, unitCostCents: 100 }).expect(201);
  const sell = (productId: string, quantity: number) =>
    gerente
      .post('/api/sales')
      .set('Idempotency-Key', randomUUID())
      .send({ items: [{ productId, quantity }], payment: { method: 'PIX' } })
      .expect(201);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const marginByCategory = async () =>
    (await gerente.get('/api/reports/margin').query({ from: today, to: today, groupBy: 'category' }).expect(200)).body as MarginRow[];

  describe('fotografia da categoria nas vendas', () => {
    it('mudar o produto de categoria NÃO leva junto o faturamento antigo', async () => {
      const papelaria = await category('Papelaria');
      const escritorio = await category('Escritório');
      const p = (await gerente.post('/api/products').send({ sku: 'CNT', name: 'Caneta', unit: 'UN', salePriceCents: 1000, categoryId: papelaria }).expect(201)).body as Product;
      await stockIn(p.id, 10);
      await sell(p.id, 2); // R$ 20 em Papelaria

      await gerente.put(`/api/products/${p.id}`).send({ ...p, categoryId: escritorio, version: 1 }).expect(200);
      await sell(p.id, 3); // R$ 30 em Escritório

      expect((await marginByCategory()).map((r) => [r.name, r.netCents])).toEqual([
        ['Escritório', 3000],
        ['Papelaria', 2000],
      ]);
    });

    it('renomear a categoria atualiza o nome no relatório; excluí-la mantém o nome da venda', async () => {
      const bebidas = await category('Bebidas');
      const outra = await category('Outra');
      const p = (await gerente.post('/api/products').send({ sku: 'SUC', name: 'Suco', unit: 'UN', salePriceCents: 500, categoryId: bebidas }).expect(201)).body as Product;
      await stockIn(p.id, 10);
      await sell(p.id, 1);

      await gerente.patch(`/api/categories/${bebidas}`).send({ name: 'Bebidas e Sucos' }).expect(200);
      expect((await marginByCategory()).map((r) => r.name)).toEqual(['Bebidas e Sucos']);

      // Move o produto para outra categoria e exclui a antiga (agora sem produtos).
      await gerente.put(`/api/products/${p.id}`).send({ ...p, categoryId: outra, version: 1 }).expect(200);
      await gerente.delete(`/api/categories/${bebidas}`).expect(204);
      // O histórico fica com o nome registrado na venda.
      expect((await marginByCategory()).map((r) => r.name)).toEqual(['Bebidas']);
    });
  });

  describe('trava de unidade com saldo fracionado', () => {
    it('KG com 2,5 em estoque não vira UN; com saldo inteiro, pode', async () => {
      const p = (await gerente.post('/api/products').send({ sku: 'ARZ', name: 'Arroz', unit: 'KG', salePriceCents: 800 }).expect(201)).body as Product;
      await stockIn(p.id, 2.5);

      const res = await gerente.put(`/api/products/${p.id}`).send({ ...p, unit: 'UN', version: 1 }).expect(409);
      expect(res.body.code).toBe('UNIT_FRACTIONAL_STOCK');
      expect((await gerente.get(`/api/products/${p.id}`).expect(200)).body.unit).toBe('KG');

      // Ajusta para inteiro (2,5 -> 3) e aí a troca é permitida.
      await gerente
        .post('/api/inventory/adjustments')
        .set('Idempotency-Key', randomUUID())
        .send({ productId: p.id, quantity: 0.5, reason: 'INVENTARIO' })
        .expect(201);
      await gerente.put(`/api/products/${p.id}`).send({ ...p, unit: 'UN', version: 1 }).expect(200);
    });

    it('a trava vale também para SQL direto (está no banco)', async () => {
      const p = (await gerente.post('/api/products').send({ sku: 'FAR', name: 'Farinha', unit: 'KG', salePriceCents: 500 }).expect(201)).body as Product;
      await stockIn(p.id, 1.25);

      await expect(prisma.$executeRawUnsafe(`UPDATE products SET unit = 'CX' WHERE id = '${p.id}'`)).rejects.toThrow(
        /UNIT_FRACTIONAL_STOCK/,
      );
      // Entre unidades fracionáveis a troca é livre (KG -> L).
      await prisma.$executeRawUnsafe(`UPDATE products SET unit = 'L' WHERE id = '${p.id}'`);
    });
  });
});
