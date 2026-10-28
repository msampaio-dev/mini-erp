import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HealthResponse } from '@mini-erp/contracts';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { Public } from '../modules/access/access-policy.js';

/**
 * Health check: usado por Docker/orquestradores e monitoramento para saber
 * se a instância pode receber tráfego. Retorna 503 se o banco estiver fora.
 */
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * LIVENESS: "o processo está vivo?". Não toca no banco. Se falhar, o orquestrador
   * reinicia o container. Se dependesse do banco, uma queda do Postgres faria todas as
   * instâncias reiniciarem em loop sem resolver nada.
   */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** READINESS: "posso receber tráfego?". Inclui o banco: sem ele, fica fora do balanceamento. */
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const database = await this.prisma.$queryRaw`SELECT 1`
      .then(() => 'up' as const)
      .catch(() => 'down' as const);

    if (database === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
