import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

type Row = { hits: number; window_ms: number; block_ms: number };

/**
 * Rate limit com contadores no Postgres (ADR 0014): todas as instâncias da API
 * compartilham o mesmo contador. Janela fixa de `ttl` ms; ao passar do limite, a chave
 * fica bloqueada por `blockDuration` ms (enquanto bloqueada, tentativas nem contam).
 *
 * Uma única instrução atômica, como no estoque: dois logins simultâneos nunca leem o
 * mesmo contador. Num UPDATE, todas as colunas enxergam os valores ANTIGOS da linha (r.*),
 * por isso a expressão dos "novos hits" se repete no cálculo do bloqueio.
 */
@Injectable()
export class PrismaThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly prisma: PrismaService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const id = `${throttlerName}:${key}`;
    const [row] = await this.prisma.$queryRaw<Row[]>`
      WITH params AS (
        SELECT make_interval(secs => ${ttl}::float8 / 1000)           AS window_len,
               make_interval(secs => ${blockDuration}::float8 / 1000) AS block_len
      )
      INSERT INTO rate_limits AS r (key, hits, window_expires_at, blocked_until)
      SELECT ${id}, 1, now() + window_len, NULL FROM params
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE
          WHEN r.blocked_until > now()      THEN r.hits      -- bloqueado: não conta
          WHEN r.window_expires_at <= now() THEN 1           -- janela nova
          ELSE r.hits + 1
        END,
        window_expires_at = CASE
          WHEN r.blocked_until > now()      THEN r.window_expires_at
          WHEN r.window_expires_at <= now() THEN now() + (SELECT window_len FROM params)
          ELSE r.window_expires_at
        END,
        blocked_until = CASE
          WHEN r.blocked_until > now() THEN r.blocked_until
          WHEN (CASE WHEN r.window_expires_at <= now() THEN 1 ELSE r.hits + 1 END) > ${limit}
            THEN now() + (SELECT block_len FROM params)
          ELSE NULL
        END
      RETURNING hits,
                greatest(0, extract(epoch FROM window_expires_at - now()) * 1000)::float8               AS window_ms,
                greatest(0, extract(epoch FROM coalesce(blocked_until, now()) - now()) * 1000)::float8 AS block_ms`;

    const blockMs = Number(row!.block_ms);
    return {
      totalHits: Number(row!.hits),
      // O @nestjs/throttler trabalha em SEGUNDOS aqui (vira o cabeçalho Retry-After).
      timeToExpire: Math.ceil(Number(row!.window_ms) / 1000),
      isBlocked: blockMs > 0,
      timeToBlockExpire: Math.ceil(blockMs / 1000),
    };
  }
}
