import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateUserInput, User } from '@mini-erp/contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import { uniqueViolationTarget } from '../../../common/prisma-errors.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { hashPassword } from '../password/password.js';
import { SessionService } from '../session/session.service.js';

const userSelect = {
  id: true,
  name: true,
  email: true,
  active: true,
  createdAt: true,
  roles: { select: { role: { select: { key: true } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const toUser = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  active: row.active,
  roles: row.roles.map(({ role }) => role.key),
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async list(): Promise<User[]> {
    const rows = await this.prisma.user.findMany({ select: userSelect, orderBy: { name: 'asc' } });
    return rows.map(toUser);
  }

  async create(input: CreateUserInput): Promise<User> {
    const passwordHash = await hashPassword(input.password);
    try {
      const row = await this.prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          roles: { create: input.roles.map((key) => ({ role: { connect: { key } } })) },
        },
        select: userSelect,
      });
      return toUser(row);
    } catch (err) {
      // Confia na constraint UNIQUE do banco em vez de "consultar antes e inserir depois":
      // a consulta prévia teria condição de corrida entre duas requisições simultâneas.
      if (uniqueViolationTarget(err) !== null) {
        throw new ConflictException('Já existe um usuário com este e-mail');
      }
      throw err;
    }
  }

  /** Desativa e derruba todas as sessões na mesma transação: o acesso cai na hora. */
  async deactivate(id: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('Você não pode desativar o próprio usuário');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({ where: { id }, data: { active: false } });
      if (count === 0) throw new NotFoundException('Usuário não encontrado');
      await this.sessions.revokeAllForUser(id, tx);
    });
  }

  async activate(id: string) {
    const { count } = await this.prisma.user.updateMany({ where: { id }, data: { active: true } });
    if (count === 0) throw new NotFoundException('Usuário não encontrado');
  }
}
