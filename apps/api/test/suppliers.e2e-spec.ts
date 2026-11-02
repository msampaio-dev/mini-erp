import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Movement, Product, Supplier } from '@mini-erp/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, resetDatabase } from './support/test-app.js';

// Números de exemplo com dígitos verificadores válidos (não pertencem a ninguém real).
const CNPJ = '11.222.333/0001-81';
const CPF = '529.982.247-25';

describe('Fornecedores (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gerente: TestAgent;
  let estoquista: TestAgent;
  let vendedor: TestAgent;

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
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (data: Record<string, unknown>) => gerente.post('/api/suppliers').send(data);

  it('cadastra com CNPJ ou CPF guardado só com dígitos; busca por nome e por documento', async () => {
    const a = (await create({ name: 'Distribuidora Paulista', document: CNPJ, phone: '(11) 3333-4444' }).expect(201)).body as Supplier;
    await create({ name: 'Sítio do Seu Zé (hortaliças)', document: CPF }).expect(201);
    await create({ name: 'Feira sem documento' }).expect(201);

    expect(a).toMatchObject({ document: '11222333000181', active: true, email: '' });
    const byName = await estoquista.get('/api/suppliers').query({ q: 'paulista' }).expect(200);
    expect(byName.body.items.map((s: Supplier) => s.id)).toEqual([a.id]);
    const byDoc = await estoquista.get('/api/suppliers').query({ q: '11.222' }).expect(200);
    expect(byDoc.body.items.map((s: Supplier) => s.id)).toEqual([a.id]);
  });

  it('recusa documento com dígito errado e documento repetido', async () => {
    const bad = await create({ name: 'Errado', document: '11.222.333/0001-82' }).expect(400);
    expect(bad.body.errors[0]).toMatchObject({ path: 'document' });
    await create({ name: 'Repetido', document: '00000000000000' }).expect(400);

    await create({ name: 'Primeiro', document: CNPJ }).expect(201);
    const dup = await create({ name: 'Segundo', document: '11222333000181' }).expect(409);
    expect(dup.body.message).toMatch(/CNPJ\/CPF/);
  });

  it('edita e desativa (nunca apaga); a lista padrão mostra só os ativos', async () => {
    const s = (await create({ name: 'Atacadão' }).expect(201)).body as Supplier;

    await gerente.put(`/api/suppliers/${s.id}`).send({ name: 'Atacadão Centro', email: 'compras@exemplo.com' }).expect(200);
    await gerente.post(`/api/suppliers/${s.id}/deactivate`).expect(200);

    expect((await gerente.get('/api/suppliers').expect(200)).body.total).toBe(0);
    const all = await gerente.get('/api/suppliers').query({ active: 'all' }).expect(200);
    expect(all.body.items[0]).toMatchObject({ name: 'Atacadão Centro', email: 'compras@exemplo.com', active: false });
  });

  it('permissões: estoquista consulta mas não cadastra; vendedor nem consulta', async () => {
    await estoquista.get('/api/suppliers').expect(200);
    await estoquista.post('/api/suppliers').send({ name: 'X' }).expect(403);
    await vendedor.get('/api/suppliers').expect(403);
  });

  describe('entrada de estoque com fornecedor e nota (ADR 0021)', () => {
    let product: Product;
    beforeEach(async () => {
      product = (await gerente.post('/api/products').send({ sku: 'CAF', name: 'Café', unit: 'UN', salePriceCents: 2000 }).expect(201)).body;
    });

    const entry = (data: Record<string, unknown>, agent = estoquista) =>
      agent
        .post('/api/inventory/entries')
        .set('Idempotency-Key', randomUUID())
        .send({ productId: product.id, quantity: 10, unitCostCents: 1200, ...data });

    it('a entrada guarda de quem veio e a nota; o kardex mostra', async () => {
      const s = (await create({ name: 'Distribuidora Paulista', document: CNPJ }).expect(201)).body as Supplier;

      const res = await entry({ supplierId: s.id, invoiceNumber: 'NF 4471' }).expect(201);

      expect(res.body).toMatchObject({ supplier: { id: s.id, name: 'Distribuidora Paulista' }, invoiceNumber: 'NF 4471' });
      const kardex = await estoquista.get('/api/inventory/movements').query({ productId: product.id }).expect(200);
      expect((kardex.body.items as Movement[])[0]).toMatchObject({ supplier: { name: 'Distribuidora Paulista' } });
    });

    it('fornecedor é opcional; inexistente → 404; desativado → 409 e nada entra', async () => {
      await entry({}).expect(201);
      await entry({ supplierId: randomUUID() }).expect(404);

      const s = (await create({ name: 'Antigo' }).expect(201)).body as Supplier;
      await gerente.post(`/api/suppliers/${s.id}/deactivate`).expect(200);
      expect((await entry({ supplierId: s.id }).expect(409)).body.code).toBe('SUPPLIER_INACTIVE');

      expect(await prisma.stockMovement.count()).toBe(1);
    });

    it('o banco só aceita fornecedor em ENTRADA', async () => {
      const s = (await create({ name: 'Qualquer' }).expect(201)).body as Supplier;
      await entry({}).expect(201);

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO stock_movements (id, product_id, type, quantity, reason, balance_after, created_by_id, supplier_id)
           SELECT gen_random_uuid(), product_id, 'ADJUSTMENT', -1, 'AVARIA', 9, created_by_id, '${s.id}' FROM stock_movements LIMIT 1`,
        ),
      ).rejects.toThrow(/stock_movements_supplier_only_entry/);
    });
  });
});
