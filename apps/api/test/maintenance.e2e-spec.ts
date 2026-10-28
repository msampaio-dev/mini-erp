import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { AccessMaintenanceService } from '../src/modules/access/maintenance/access-maintenance.service.js';
import { PrismaThrottlerStorage } from '../src/modules/access/rate-limit/prisma-throttler.storage.js';
import { createTestApp, createUser, resetDatabase } from './support/test-app.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Rate limit no Postgres e faxina (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storage: PrismaThrottlerStorage;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    storage = new PrismaThrottlerStorage(prisma);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const key = () => randomBytes(8).toString('hex');

  describe('PrismaThrottlerStorage', () => {
    it('conta dentro da janela e bloqueia ao passar do limite', async () => {
      const k = key();
      const results = [];
      for (let i = 0; i < 5; i++) results.push(await storage.increment(k, 60_000, 3, 60_000, 'login'));

      expect(results.map((r) => [r.totalHits, r.isBlocked])).toEqual([
        [1, false],
        [2, false],
        [3, false],
        [4, true],
        [4, true], // bloqueado: tentativas nem contam
      ]);
      expect(results[3]!.timeToBlockExpire).toBeGreaterThan(55); // segundos
    });

    it('CONCORRÊNCIA: 20 tentativas simultâneas → contagem exata, sem perder nenhuma', async () => {
      const k = key();

      const results = await Promise.all(Array.from({ length: 20 }, () => storage.increment(k, 60_000, 100, 60_000, 'login')));

      expect(results.map((r) => r.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it('janela e bloqueio expiram', async () => {
      const k = key();
      await storage.increment(k, 300, 1, 300, 'login');
      expect((await storage.increment(k, 300, 1, 300, 'login')).isBlocked).toBe(true);

      await sleep(450);

      expect(await storage.increment(k, 300, 1, 300, 'login')).toMatchObject({ totalHits: 1, isBlocked: false });
    });

    it('chaves e throttlers diferentes não se misturam', async () => {
      const k = key();
      await storage.increment(k, 60_000, 1, 60_000, 'login');
      await storage.increment(k, 60_000, 1, 60_000, 'login');

      expect((await storage.increment(k, 60_000, 1, 60_000, 'outro')).isBlocked).toBe(false);
      expect((await storage.increment(key(), 60_000, 1, 60_000, 'login')).isBlocked).toBe(false);
    });
  });

  it('faxina remove só sessões vencidas e contadores expirados e desbloqueados', async () => {
    const user = await createUser(prisma, 'faxina@teste.com', ['VENDEDOR']);
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);
    await prisma.session.createMany({
      data: [
        { id: 'vencida', userId: user.id, expiresAt: past },
        { id: 'valida', userId: user.id, expiresAt: future },
      ],
    });
    await prisma.rateLimit.createMany({
      data: [
        { key: 'expirado', hits: 3, windowExpiresAt: past },
        { key: 'expirado-mas-bloqueado', hits: 9, windowExpiresAt: past, blockedUntil: future },
        { key: 'ativo', hits: 1, windowExpiresAt: future },
      ],
    });

    const removed = await app.get(AccessMaintenanceService).purgeExpired();

    expect(removed).toEqual({ sessions: 1, rateLimits: 1 });
    expect((await prisma.session.findMany()).map((s) => s.id)).toEqual(['valida']);
    expect((await prisma.rateLimit.findMany({ orderBy: { key: 'asc' } })).map((r) => r.key)).toEqual([
      'ativo',
      'expirado-mas-bloqueado',
    ]);
  });
});
