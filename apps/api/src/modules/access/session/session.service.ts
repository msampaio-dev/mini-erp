import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../../config/env.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { buildAuthContext, userWithAccessSelect, type AuthContext } from '../auth-context.js';

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface ValidatedSession {
  auth: AuthContext;
  /** Preenchido quando a sessão foi renovada e o cookie precisa ser reenviado. */
  renewedUntil?: Date;
}

/** O banco guarda só o hash: um dump vazado não permite sequestrar sessões. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionService {
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('SESSION_TTL_HOURS', { infer: true }) * 60 * 60 * 1000;
  }

  async create(userId: string, meta: SessionMeta) {
    // 256 bits de entropia: impossível de adivinhar por força bruta.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);

    await this.prisma.$transaction([
      // Faxina oportunista: remove sessões vencidas do mesmo usuário.
      this.prisma.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } }),
      this.prisma.session.create({
        data: {
          id: hashToken(token),
          userId,
          expiresAt,
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 512),
        },
      }),
    ]);

    return { token, expiresAt };
  }

  /**
   * Valida o token do cookie e devolve quem é o usuário, com permissões.
   * Retorna null se a sessão não existe, expirou ou o usuário foi desativado.
   */
  async validate(token: string): Promise<ValidatedSession | null> {
    const id = hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { id },
      select: {
        expiresAt: true,
        user: { select: { ...userWithAccessSelect, active: true } },
      },
    });

    if (!session || !session.user.active) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.prisma.session.deleteMany({ where: { id } });
      return null;
    }

    const auth = buildAuthContext(id, session.user);

    // Expiração deslizante, mas só grava quando passou da metade do TTL:
    // evita um UPDATE no banco a cada request.
    if (session.expiresAt.getTime() - now < this.ttlMs / 2) {
      const renewedUntil = new Date(now + this.ttlMs);
      await this.prisma.session.update({ where: { id }, data: { expiresAt: renewedUntil } });
      return { auth, renewedUntil };
    }

    return { auth };
  }

  async revoke(sessionId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async revokeToken(token: string) {
    await this.revoke(hashToken(token));
  }

  /** Derruba todas as sessões do usuário. Aceita uma transação externa. */
  async revokeAllForUser(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    await tx.session.deleteMany({ where: { userId } });
  }
}
