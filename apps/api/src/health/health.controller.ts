import { Controller, Get, HttpStatus, NotFoundException, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * LIVENESS: "o processo está vivo?". Não toca no banco. Se falhar, o orquestrador
   * reinicia o container. Se dependesse do banco, uma queda do Postgres faria todas as
   * instâncias reiniciarem em loop sem resolver nada.
   */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * DIAGNÓSTICO (desligado por padrão, DIAGNOSTICS=true): mostra que IP a API enxerga e a
   * cadeia X-Forwarded-For. Serve para calibrar o TRUST_PROXY num provedor novo (ADR 0015):
   * com o valor certo, `ip` é o IP real do cliente e um X-Forwarded-For forjado não o altera.
   */
  @Get('client-ip')
  clientIp(@Req() req: Request) {
    if (!this.config.get('DIAGNOSTICS', { infer: true })) throw new NotFoundException();
    // Cabeçalhos que proxies/CDNs costumam usar para o IP do cliente. Para escolher qual
    // é confiável, compare: um valor que o cliente forja e passa intacto NÃO serve.
    const headers = ['x-forwarded-for', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'forwarded'];
    return {
      ip: req.ip,
      ips: req.ips,
      remoteAddress: req.socket.remoteAddress ?? null,
      forwardedFor: req.get('x-forwarded-for') ?? null,
      headers: Object.fromEntries(headers.map((h) => [h, req.get(h) ?? null])),
    };
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
