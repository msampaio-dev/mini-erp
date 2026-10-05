import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, createUser, loginAs, resetDatabase, TEST_PASSWORD } from './support/test-app.js';

describe('Acesso (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, 'admin@teste.com', ['ADMIN']);
    await createUser(prisma, 'vendedor@teste.com', ['VENDEDOR']);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('login', () => {
    it('cria sessão com cookie httpOnly + SameSite=Lax e devolve as permissões', async () => {
      const res = await http()
        .post('/api/auth/login')
        .send({ email: 'VENDEDOR@teste.com ', password: TEST_PASSWORD }) // normaliza e-mail
        .expect(200);

      const cookie = res.get('Set-Cookie')?.[0] ?? '';
      expect(cookie).toMatch(/^erp_session=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(res.body).toMatchObject({
        email: 'vendedor@teste.com',
        roles: ['VENDEDOR'],
        permissions: ['estoque:ler', 'produtos:ler', 'vendas:criar', 'vendas:ler'],
      });
    });

    it('guarda no banco apenas o hash do token, nunca o token', async () => {
      const res = await http()
        .post('/api/auth/login')
        .send({ email: 'admin@teste.com', password: TEST_PASSWORD });
      const token = /erp_session=([^;]+)/.exec(res.get('Set-Cookie')![0]!)![1]!;

      const sessions = await prisma.session.findMany();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).not.toBe(token);
      expect(sessions[0]!.id).toBe(createHash('sha256').update(token).digest('hex'));
    });

    it('responde igual para senha errada e e-mail inexistente (anti-enumeração)', async () => {
      const wrongPassword = await http()
        .post('/api/auth/login')
        .send({ email: 'admin@teste.com', password: 'errada-errada' })
        .expect(401);
      const unknownEmail = await http()
        .post('/api/auth/login')
        .send({ email: 'ninguem@teste.com', password: 'errada-errada' })
        .expect(401);

      expect(wrongPassword.body.message).toBe('E-mail ou senha inválidos');
      expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
    });

    it('rejeita corpo inválido com 400 e detalhes por campo', async () => {
      const res = await http().post('/api/auth/login').send({ email: 'nao-e-email' }).expect(400);

      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
      );
    });
  });

  describe('autorização', () => {
    it('401 sem sessão', async () => {
      await http().get('/api/auth/me').expect(401);
    });

    it('403 quando falta permissão; 200 quando tem', async () => {
      const vendedor = await loginAs(app, 'vendedor@teste.com');
      const admin = await loginAs(app, 'admin@teste.com');

      const denied = await vendedor.get('/api/users').expect(403);
      expect(denied.body.message).toContain('usuarios:gerenciar');
      await admin.get('/api/users').expect(200);
    });

    it('health check continua público', async () => {
      await http().get('/api/health').expect(200);
    });
  });

  describe('gestão de usuários', () => {
    it('cria usuário, impede e-mail duplicado (409) e valida a senha', async () => {
      const admin = await loginAs(app, 'admin@teste.com');
      const novo = { name: 'Estoquista', email: 'estoque@teste.com', password: 'senha-forte-123', roles: ['ESTOQUISTA'] };

      const res = await admin.post('/api/users').send(novo).expect(201);
      expect(res.body).toMatchObject({ email: 'estoque@teste.com', active: true, roles: ['ESTOQUISTA'] });
      expect(res.body).not.toHaveProperty('passwordHash');

      await admin.post('/api/users').send(novo).expect(409);
      await admin.post('/api/users').send({ ...novo, email: 'x@teste.com', password: 'curta' }).expect(400);
    });

    it('desativar um usuário derruba a sessão dele imediatamente (D7)', async () => {
      const admin = await loginAs(app, 'admin@teste.com');
      const vendedor = await loginAs(app, 'vendedor@teste.com');
      await vendedor.get('/api/auth/me').expect(200);

      const { id } = await prisma.user.findUniqueOrThrow({ where: { email: 'vendedor@teste.com' } });
      await admin.post(`/api/users/${id}/deactivate`).expect(204);

      await vendedor.get('/api/auth/me').expect(401);
      await http()
        .post('/api/auth/login')
        .send({ email: 'vendedor@teste.com', password: TEST_PASSWORD })
        .expect(401);
    });

    it('impede o admin de desativar a si mesmo', async () => {
      const admin = await loginAs(app, 'admin@teste.com');
      const { id } = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@teste.com' } });

      await admin.post(`/api/users/${id}/deactivate`).expect(400);
    });
  });

  it('logout encerra a sessão no servidor', async () => {
    const vendedor = await loginAs(app, 'vendedor@teste.com');

    await vendedor.post('/api/auth/logout').expect(204);

    await vendedor.get('/api/auth/me').expect(401);
    expect(await prisma.session.count()).toBe(0);
  });
});
