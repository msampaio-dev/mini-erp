import { BadRequestException, Injectable, UnauthorizedException, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ChangePasswordInput, LoginInput } from '@mini-erp/contracts';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { hashPassword, needsRehash, verifyPassword } from '../password/password.js';
import { SessionService, type SessionMeta } from '../session/session.service.js';

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos';

@Injectable()
export class AuthService implements OnModuleInit {
  /** Hash de uma senha aleatória, usado quando o e-mail não existe. */
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async onModuleInit() {
    this.dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  }

  async login(input: LoginInput, meta: SessionMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, passwordHash: true, active: true },
    });

    // Anti-enumeração: mesmo sem usuário, roda o Argon2 contra um hash falso.
    // Assim "e-mail inexistente" e "senha errada" levam o mesmo tempo e
    // devolvem a mesma mensagem: o atacante não descobre quais e-mails existem.
    const valid = await verifyPassword(user?.passwordHash ?? this.dummyHash, input.password);

    if (!user || !valid || !user.active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // Se os parâmetros do Argon2 foram endurecidos, aproveita o login
    // (único momento em que temos a senha em texto) para atualizar o hash.
    if (needsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.password) },
      });
    }

    return this.sessions.create(user.id, meta);
  }

  /**
   * Troca da própria senha. Exige a senha atual: quem roubou só a sessão (cookie) não consegue
   * trocar a senha e trancar o dono fora. Depois, as OUTRAS sessões caem (outros aparelhos,
   * ou um invasor) e a sessão atual continua.
   */
  async changePassword(userId: string, sessionId: string, input: ChangePasswordInput) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      // 400 com erro no campo, e não 401: 401 significaria "sessão inválida" e o front faria logout.
      throw new BadRequestException({
        message: 'Dados inválidos',
        errors: [{ path: 'currentPassword', message: 'Senha atual incorreta' }],
      });
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.sessions.revokeOthers(userId, sessionId, tx);
    });
  }
}
