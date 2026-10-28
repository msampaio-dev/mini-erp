import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, resetDatabase, TEST_PASSWORD } from './support/test-app.js';

const NOVA = 'nova-senha-forte-456';

describe('Senhas, papéis e categorias (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const login = (email: string, password: string) => http().post('/api/auth/login').send({ email, password });
  const idOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

  describe('troca da própria senha', () => {
    it('exige a senha atual, mantém a sessão atual e derruba as outras', async () => {
      await createUser(prisma, 'ana@teste.com', ['VENDEDOR']);
      const notebook = await loginAs(app, 'ana@teste.com');
      const celular = await loginAs(app, 'ana@teste.com');

      const errada = await notebook.post('/api/auth/password').send({ currentPassword: 'errada-errada', newPassword: NOVA }).expect(400);
      expect(errada.body.errors[0].path).toBe('currentPassword');

      await notebook.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: NOVA }).expect(204);

      await notebook.get('/api/auth/me').expect(200); // sessão atual segue
      await celular.get('/api/auth/me').expect(401); // a outra caiu
      await login('ana@teste.com', TEST_PASSWORD).expect(401);
      await login('ana@teste.com', NOVA).expect(200);
    });

    it('a nova senha precisa ser diferente e forte', async () => {
      await createUser(prisma, 'ana@teste.com', ['VENDEDOR']);
      const ana = await loginAs(app, 'ana@teste.com');

      await ana.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }).expect(400);
      await ana.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: 'curta' }).expect(400);
    });
  });

  describe('administração de usuários', () => {
    it('redefinir a senha de outro usuário derruba as sessões dele', async () => {
      await createUser(prisma, 'admin@teste.com', ['ADMIN']);
      await createUser(prisma, 'ana@teste.com', ['VENDEDOR']);
      const admin = await loginAs(app, 'admin@teste.com');
      const ana = await loginAs(app, 'ana@teste.com');

      await admin.post(`/api/users/${await idOf('ana@teste.com')}/password`).send({ newPassword: NOVA }).expect(204);

      await ana.get('/api/auth/me').expect(401);
      await login('ana@teste.com', NOVA).expect(200);
      await admin.post(`/api/users/${await idOf('admin@teste.com')}/password`).send({ newPassword: NOVA }).expect(400);
    });

    it('trocar papéis vale na PRÓXIMA requisição, sem novo login', async () => {
      await createUser(prisma, 'admin@teste.com', ['ADMIN']);
      await createUser(prisma, 'ana@teste.com', ['ESTOQUISTA']);
      const admin = await loginAs(app, 'admin@teste.com');
      const ana = await loginAs(app, 'ana@teste.com');
      await ana.get('/api/sales').expect(403);

      const res = await admin.put(`/api/users/${await idOf('ana@teste.com')}/roles`).send({ roles: ['VENDEDOR'] }).expect(200);

      expect(res.body.roles).toEqual(['VENDEDOR']);
      await ana.get('/api/sales').expect(200);
      expect((await ana.get('/api/auth/me')).body.roles).toEqual(['VENDEDOR']);
    });

    it('ninguém altera os próprios papéis', async () => {
      await createUser(prisma, 'admin@teste.com', ['ADMIN']);
      const admin = await loginAs(app, 'admin@teste.com');

      await admin.put(`/api/users/${await idOf('admin@teste.com')}/roles`).send({ roles: ['VENDEDOR'] }).expect(400);
    });

    it('com outro admin ativo, um admin pode ser rebaixado ou desativado', async () => {
      await createUser(prisma, 'admin@teste.com', ['ADMIN']);
      await createUser(prisma, 'chefe@teste.com', ['ADMIN']);
      const admin = await loginAs(app, 'admin@teste.com');
      const chefe = await idOf('chefe@teste.com');

      await admin.post(`/api/users/${chefe}/deactivate`).expect(204);
      await admin.post(`/api/users/${chefe}/activate`).expect(204);
      await admin.put(`/api/users/${chefe}/roles`).send({ roles: ['GERENTE'] }).expect(200);
      // Note: em SEQUÊNCIA a regra do "último admin" é inalcançável (só admin administra e
      // ninguém altera a si mesmo, então há sempre >= 2). Ela existe para a CONCORRÊNCIA abaixo.
    });

    it('CONCORRÊNCIA: 2 admins tirando o papel um do outro ao mesmo tempo → sempre sobra 1 (10 rodadas)', async () => {
      const outcomes: number[] = [];
      for (let round = 0; round < 10; round++) {
        await resetDatabase(prisma);
        await createUser(prisma, 'a@teste.com', ['ADMIN']);
        await createUser(prisma, 'b@teste.com', ['ADMIN']);
        const [a, b] = await Promise.all([loginAs(app, 'a@teste.com'), loginAs(app, 'b@teste.com')]);
        const [idA, idB] = await Promise.all([idOf('a@teste.com'), idOf('b@teste.com')]);

        const results = await Promise.all([
          a.put(`/api/users/${idB}/roles`).send({ roles: ['GERENTE'] }),
          b.put(`/api/users/${idA}/roles`).send({ roles: ['GERENTE'] }),
        ]);

        const statuses = results.map((r) => r.status).sort((x, y) => x - y);
        // O perdedor recebe 403 se, quando passou pela autorização, já não era admin; ou 409
        // (LAST_ADMIN) se passou ANTES e foi barrado pela trava. O 409 é o caso que importa.
        expect(statuses[0]).toBe(200);
        expect([403, 409]).toContain(statuses[1]);
        expect(await prisma.userRole.count({ where: { role: { key: 'ADMIN' } } })).toBe(1);
        outcomes.push(statuses[1]!);
      }
      // Garante que a trava foi de fato EXERCITADA (não só o 403 da autorização).
      expect(outcomes).toContain(409);
    });
  });

  describe('categorias', () => {
    let gerente: TestAgent;

    beforeEach(async () => {
      await createUser(prisma, 'gerente@teste.com', ['GERENTE']);
      gerente = await loginAs(app, 'gerente@teste.com');
    });

    it('renomeia respeitando o nome único sem diferenciar maiúsculas', async () => {
      const a = (await gerente.post('/api/categories').send({ name: 'Bebidas' }).expect(201)).body;
      await gerente.post('/api/categories').send({ name: 'Limpeza' }).expect(201);

      await gerente.patch(`/api/categories/${a.id}`).send({ name: 'Bebidas e Sucos' }).expect(200);
      await gerente.patch(`/api/categories/${a.id}`).send({ name: 'LIMPEZA' }).expect(409);
    });

    it('só exclui categoria sem produtos', async () => {
      const usada = (await gerente.post('/api/categories').send({ name: 'Usada' }).expect(201)).body;
      const vazia = (await gerente.post('/api/categories').send({ name: 'Vazia' }).expect(201)).body;
      await gerente.post('/api/products').send({ sku: 'X', name: 'Produto', unit: 'UN', salePriceCents: 100, categoryId: usada.id }).expect(201);

      const res = await gerente.delete(`/api/categories/${usada.id}`).expect(409);
      expect(res.body).toMatchObject({ code: 'CATEGORY_IN_USE' });
      expect(res.body.message).toContain('1 produto');
      await gerente.delete(`/api/categories/${vazia.id}`).expect(204);
      await gerente.delete(`/api/categories/${vazia.id}`).expect(404);
    });
  });
});
