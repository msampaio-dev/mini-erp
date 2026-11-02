import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Product } from '@mini-erp/contracts';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, resetDatabase } from './support/test-app.js';

const caneta = {
  sku: 'cnt-azul',
  name: 'Caneta Azul',
  unit: 'UN',
  salePriceCents: 250,
  minStock: 10,
  barcode: '7891000315507',
};

describe('Catálogo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gerente: TestAgent;
  let estoquista: TestAgent;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, 'gerente@teste.com', ['GERENTE']);
    await createUser(prisma, 'estoquista@teste.com', ['ESTOQUISTA']);
    gerente = await loginAs(app, 'gerente@teste.com');
    estoquista = await loginAs(app, 'estoquista@teste.com');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProduct(overrides: Record<string, unknown> = {}): Promise<Product> {
    const res = await gerente.post('/api/products').send({ ...caneta, ...overrides }).expect(201);
    return res.body as Product;
  }

  describe('cadastro', () => {
    it('cria produto normalizando o SKU e com versão 1', async () => {
      const p = await createProduct();

      expect(p).toMatchObject({ sku: 'CNT-AZUL', status: 'ACTIVE', version: 1, minStock: 10, category: null });
    });

    it('409 para SKU duplicado e para código de barras duplicado, com mensagens distintas', async () => {
      await createProduct();

      const sku = await gerente.post('/api/products').send({ ...caneta, barcode: null }).expect(409);
      const ean = await gerente.post('/api/products').send({ ...caneta, sku: 'OUTRO' }).expect(409);

      expect(sku.body.message).toContain('SKU');
      expect(ean.body.message).toContain('código de barras');
    });

    it('400 para código de barras com dígito verificador errado', async () => {
      const res = await gerente.post('/api/products').send({ ...caneta, barcode: '7891000315508' }).expect(400);

      expect(res.body.errors[0].path).toBe('barcode');
    });

    it('400 para categoria inexistente (chave estrangeira)', async () => {
      await gerente
        .post('/api/products')
        .send({ ...caneta, categoryId: '0199a6a0-0000-7000-8000-000000000000' })
        .expect(400);
    });

    it('vários produtos podem ficar sem código de barras', async () => {
      await createProduct({ barcode: null });
      await createProduct({ sku: 'OUTRO', barcode: null });
    });
  });

  describe('código de balança (ADR 0020)', () => {
    const banana = { sku: 'BAN', name: 'Banana prata', unit: 'KG', salePriceCents: 699 };

    it('guarda com 6 dígitos, busca exata pelo código e recusa duplicado', async () => {
      const res = await gerente.post('/api/products').send({ ...banana, scaleCode: '123' }).expect(201);
      expect(res.body.scaleCode).toBe('000123');

      const found = await gerente.get('/api/products').query({ scaleCode: '123' }).expect(200);
      expect(found.body.items.map((p: { sku: string }) => p.sku)).toEqual(['BAN']);

      const dup = await gerente.post('/api/products').send({ ...banana, sku: 'BAN2', scaleCode: '000123' }).expect(409);
      expect(dup.body.message).toMatch(/código de balança/);
    });

    it('só em produto vendido por KG; formato validado', async () => {
      const un = await gerente.post('/api/products').send({ ...caneta, scaleCode: '5' }).expect(400);
      expect(un.body.errors[0]).toMatchObject({ path: 'scaleCode' });
      await gerente.post('/api/products').send({ ...banana, scaleCode: '1234567' }).expect(400);
      await gerente.post('/api/products').send({ ...banana, scaleCode: '12a' }).expect(400);
    });
  });

  it('configurações da loja: qualquer usuário logado lê; sem login, não', async () => {
    const res = await gerente.get('/api/store/settings').expect(200);
    expect(res.body).toEqual({ name: 'Mini-ERP', document: '', address: '', scaleLabelMode: 'WEIGHT' });
    await request(app.getHttpServer()).get('/api/store/settings').expect(401);
  });

  describe('permissões', () => {
    it('estoquista consulta, mas não cadastra nem edita', async () => {
      const p = await createProduct();

      await estoquista.get('/api/products').expect(200);
      await estoquista.get(`/api/products/${p.id}`).expect(200);
      await estoquista.post('/api/products').send({ ...caneta, sku: 'X' }).expect(403);
      await estoquista.put(`/api/products/${p.id}`).send({ ...caneta, version: 1 }).expect(403);
    });
  });

  describe('edição com optimistic locking (D13)', () => {
    it('incrementa a versão a cada edição', async () => {
      const p = await createProduct();

      const res = await gerente.put(`/api/products/${p.id}`).send({ ...caneta, name: 'Caneta Azul BIC', version: 1 }).expect(200);

      expect(res.body).toMatchObject({ name: 'Caneta Azul BIC', version: 2 });
    });

    it('409 ao salvar com versão desatualizada: a alteração do outro não é perdida', async () => {
      const p = await createProduct();
      await gerente.put(`/api/products/${p.id}`).send({ ...caneta, salePriceCents: 300, version: 1 }).expect(200);

      // Segundo usuário abriu o formulário ainda na versão 1 e muda o nome.
      const res = await gerente.put(`/api/products/${p.id}`).send({ ...caneta, name: 'Outro nome', version: 1 }).expect(409);

      expect(res.body).toMatchObject({ code: 'VERSION_CONFLICT' });
      expect(res.body.message).toContain('alterado por outra pessoa');
      const atual = await gerente.get(`/api/products/${p.id}`).expect(200);
      expect(atual.body).toMatchObject({ salePriceCents: 300, name: 'Caneta Azul', version: 2 });
    });

    it('duas edições simultâneas com a mesma versão: exatamente uma vence', async () => {
      const p = await createProduct();

      const results = await Promise.all(
        ['A', 'B', 'C', 'D', 'E'].map((suffix) =>
          gerente.put(`/api/products/${p.id}`).send({ ...caneta, name: `Nome ${suffix}`, version: 1 }),
        ),
      );

      const statuses = results.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409, 409, 409, 409]);
      const final = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
      expect(final.version).toBe(2);
    });

    it('404 para produto inexistente', async () => {
      await gerente
        .put('/api/products/0199a6a0-0000-7000-8000-000000000000')
        .send({ ...caneta, version: 1 })
        .expect(404);
    });
  });

  describe('arquivamento (D12)', () => {
    it('arquivado some da lista padrão, mas continua consultável', async () => {
      const p = await createProduct();

      const archived = await gerente.post(`/api/products/${p.id}/archive`).expect(200);
      expect(archived.body).toMatchObject({ status: 'ARCHIVED', version: 2 });

      const ativos = await gerente.get('/api/products').expect(200);
      const todos = await gerente.get('/api/products?status=ALL').expect(200);
      expect(ativos.body.total).toBe(0);
      expect(todos.body.total).toBe(1);
      await gerente.get(`/api/products/${p.id}`).expect(200);

      await gerente.post(`/api/products/${p.id}/unarchive`).expect(200);
      expect((await gerente.get('/api/products').expect(200)).body.total).toBe(1);
    });
  });

  describe('busca e paginação (D15)', () => {
    it('busca parcial por nome, sem diferenciar maiúsculas, e por SKU', async () => {
      await createProduct({ name: 'Caneta Azul BIC', barcode: null });
      await createProduct({ sku: 'CNT-VERM', name: 'Caneta Vermelha', barcode: null });
      await createProduct({ sku: 'LAP-01', name: 'Lápis HB', barcode: null });

      const porNome = await gerente.get('/api/products').query({ q: 'caneta az' }).expect(200);
      const porSku = await gerente.get('/api/products').query({ q: 'cnt-' }).expect(200);

      expect(porNome.body.items.map((p: Product) => p.name)).toEqual(['Caneta Azul BIC']);
      expect(porSku.body.total).toBe(2);
    });

    it('pagina com total correto e ordem estável', async () => {
      for (let i = 1; i <= 5; i++) {
        await createProduct({ sku: `P-${i}`, name: `Produto ${i}`, barcode: null });
      }

      const p1 = await gerente.get('/api/products').query({ page: 1, pageSize: 2 }).expect(200);
      const p3 = await gerente.get('/api/products').query({ page: 3, pageSize: 2 }).expect(200);

      expect(p1.body).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      expect(p1.body.items.map((p: Product) => p.sku)).toEqual(['P-1', 'P-2']);
      expect(p3.body.items.map((p: Product) => p.sku)).toEqual(['P-5']);
    });

    it('400 para pageSize acima do limite', async () => {
      await gerente.get('/api/products').query({ pageSize: 1000 }).expect(400);
    });
  });

  describe('categorias', () => {
    it('nome único sem diferenciar maiúsculas (citext)', async () => {
      const cat = await gerente.post('/api/categories').send({ name: 'Papelaria' }).expect(201);
      await gerente.post('/api/categories').send({ name: 'PAPELARIA' }).expect(409);

      const p = await createProduct({ categoryId: cat.body.id });
      expect(p.category).toEqual({ id: cat.body.id, name: 'Papelaria' });

      const filtrado = await gerente.get('/api/products').query({ categoryId: cat.body.id }).expect(200);
      expect(filtrado.body.total).toBe(1);
    });
  });

  it('o banco recusa preço negativo mesmo via SQL direto (CHECK)', async () => {
    const p = await createProduct();

    await expect(
      prisma.$executeRawUnsafe(`UPDATE products SET sale_price_cents = -1 WHERE id = '${p.id}'`),
    ).rejects.toThrow(/products_sale_price_nonnegative/);
  });
});
