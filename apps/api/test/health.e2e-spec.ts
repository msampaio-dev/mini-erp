import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './support/test-app.js';

describe('GET /api/health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde ok com o banco conectado', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });
});

describe('Endurecimento HTTP (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('diagnóstico de IP fica desligado por padrão (404)', async () => {
    await request(app.getHttpServer()).get('/api/health/client-ip').expect(404);
  });

  it('liveness não depende do banco', async () => {
    await request(app.getHttpServer()).get('/api/health/live').expect(200, { status: 'ok' });
  });

  it('toda resposta traz X-Request-Id; um ID seguro vindo do proxy é reaproveitado', async () => {
    const gerado = await request(app.getHttpServer()).get('/api/health');
    expect(gerado.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const repassado = await request(app.getHttpServer()).get('/api/health').set('X-Request-Id', 'abc-12345678');
    expect(repassado.headers['x-request-id']).toBe('abc-12345678');

    // Quebra de linha o próprio HTTP proíbe; o risco real são caracteres válidos no protocolo
    // mas que sujam/forjam o log, ou IDs enormes. Esses são descartados e trocados por um UUID.
    for (const sujo of ['x" status=200 user=admin', '<script>alert(1)</script>', 'a'.repeat(500)]) {
      const res = await request(app.getHttpServer()).get('/api/health').set('X-Request-Id', sujo);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('cabeçalhos de segurança do helmet', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined(); // não anuncia "Express"
  });

  it('erros conhecidos continuam com o formato de sempre', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, message: 'Sessão ausente' });
  });
});
