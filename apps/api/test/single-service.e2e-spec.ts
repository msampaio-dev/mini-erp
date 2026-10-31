import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/** Modo "um serviço só" (Render, ADR 0015): a API também serve o build do React. */
describe('API servindo o front (e2e)', () => {
  let app: INestApplication<App>;
  let dist: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'web-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Mini-ERP</title>');
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    process.env['WEB_DIST_DIR'] = dist;
    process.env['DIAGNOSTICS'] = 'true';
    // Import DEPOIS de definir o ambiente: o ConfigModule.forRoot() valida as variáveis no
    // momento em que o AppModule é importado (imports estáticos rodam antes do beforeAll).
    const { createTestApp } = await import('./support/test-app.js');
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    delete process.env['WEB_DIST_DIR'];
    delete process.env['DIAGNOSTICS'];
    rmSync(dist, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());

  it('serve o index.html na raiz e em rotas do React (fallback de SPA), sem cache', async () => {
    for (const path of ['/', '/vendas/nova', '/produtos/123']) {
      const res = await http().get(path).expect(200);
      expect(res.text).toContain('<title>Mini-ERP</title>');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('assets com hash têm cache imutável de 1 ano', async () => {
    const res = await http().get('/assets/index-abc123.js').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('a página sai com CSP restritiva (só scripts do próprio site)', async () => {
    const res = await http().get('/');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('rotas /api continuam sendo da API: inexistente = 404 JSON, nunca o index.html', async () => {
    const res = await http().get('/api/nao-existe').expect(404);
    expect(res.headers['content-type']).toContain('application/json');
    await http().get('/api/health/live').expect(200, { status: 'ok' });
  });

  it('diagnóstico de IP (só com DIAGNOSTICS=true) mostra a cadeia X-Forwarded-For', async () => {
    const res = await http().get('/api/health/client-ip').set('X-Forwarded-For', '203.0.113.7').expect(200);
    expect(res.body).toMatchObject({ forwardedFor: '203.0.113.7' });
    expect(res.body).toHaveProperty('ip');
  });
});
