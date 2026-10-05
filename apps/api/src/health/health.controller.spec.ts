import { HttpStatus } from '@nestjs/common';
import { healthResponseSchema } from '@mini-erp/contracts';
import { HealthController } from './health.controller.js';
import type { PrismaService } from '../infra/prisma/prisma.service.js';

function makeController(queryRaw: () => Promise<unknown>) {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const res = { status: vi.fn() };
  return { controller: new HealthController(prisma), res };
}

describe('HealthController', () => {
  it('retorna ok quando o banco responde', async () => {
    const { controller, res } = makeController(() => Promise.resolve([{ '?column?': 1 }]));

    const body = await controller.check(res as never);

    expect(healthResponseSchema.parse(body)).toMatchObject({ status: 'ok', database: 'up' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('retorna 503 e degraded quando o banco está fora', async () => {
    const { controller, res } = makeController(() => Promise.reject(new Error('ECONNREFUSED')));

    const body = await controller.check(res as never);

    expect(body).toMatchObject({ status: 'degraded', database: 'down' });
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
