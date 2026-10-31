import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

const EVERY_HOUR = 60 * 60 * 1000;

/**
 * Faxina periódica (ADR 0014):
 * - sessões vencidas: antes só eram apagadas quando O MESMO usuário fazia login de novo;
 *   sessões de quem nunca voltava ficavam para sempre na tabela;
 * - contadores de rate limit expirados e já desbloqueados.
 *
 * Com várias instâncias, cada uma roda a sua faxina: tudo bem, os DELETEs são idempotentes
 * (o segundo simplesmente não encontra nada). Não precisamos de um "líder" nem de fila.
 */
@Injectable()
export class AccessMaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AccessMaintenanceService.name);
  private timer?: NodeJS.Timeout;
  /** Faxina em andamento: o desligamento espera por ela antes de fechar o banco. */
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    // unref(): o timer não impede o processo de encerrar (testes, deploys).
    this.timer = setInterval(() => this.start(), EVERY_HOUR).unref();
    this.start();
  }

  /**
   * Desligamento gracioso: sem esperar, um deploy (SIGTERM) que caísse no meio da faxina
   * fecharia o pool de conexões debaixo dela ("Unable to start a transaction").
   */
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  private start() {
    this.running = this.running.then(() => this.runSafely());
  }

  /** Remove o que expirou. Público para testes e para rodar manualmente. */
  async purgeExpired(): Promise<{ sessions: number; rateLimits: number }> {
    const now = new Date();
    const [sessions, rateLimits] = await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.rateLimit.deleteMany({
        where: {
          windowExpiresAt: { lt: now },
          OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }],
        },
      }),
    ]);
    return { sessions: sessions.count, rateLimits: rateLimits.count };
  }

  private async runSafely() {
    try {
      const removed = await this.purgeExpired();
      if (removed.sessions || removed.rateLimits) this.logger.log({ message: 'faxina concluída', ...removed });
    } catch (err) {
      // Faxina falhar nunca derruba a API: tenta de novo na próxima hora.
      this.logger.error({ message: 'faxina falhou', error: String(err) });
    }
  }
}
