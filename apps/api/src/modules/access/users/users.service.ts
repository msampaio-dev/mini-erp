import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateUserInput, RoleKey, User } from '@mini-erp/contracts';
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
      await this.assertKeepsAnAdmin(tx, id);
      const { count } = await tx.user.updateMany({ where: { id }, data: { active: false } });
      if (count === 0) throw new NotFoundException('Usuário não encontrado');
      await this.sessions.revokeAllForUser(id, tx);
    });
  }

  /**
   * Troca os papéis. Vale na PRÓXIMA requisição do usuário: as permissões são carregadas
   * a cada request (ADR 0007), não ficam congeladas na sessão.
   */
  async updateRoles(id: string, roles: RoleKey[], actorId: string): Promise<User> {
    if (id === actorId) {
      // Evita que um admin tire de si mesmo o acesso à tela que permitiria desfazer o erro.
      throw new BadRequestException('Você não pode alterar os próprios papéis');
    }
    await this.prisma.$transaction(async (tx) => {
      if (!roles.includes('ADMIN')) await this.assertKeepsAnAdmin(tx, id);
      const exists = await tx.user.count({ where: { id } });
      if (!exists) throw new NotFoundException('Usuário não encontrado');
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({
        data: (await tx.role.findMany({ where: { key: { in: roles } }, select: { id: true } })).map((r) => ({
          userId: id,
          roleId: r.id,
        })),
      });
    });
    return toUser(await this.prisma.user.findUniqueOrThrow({ where: { id }, select: userSelect }));
  }

  /** Administrador define uma senha nova (usuário esqueceu): as sessões dele caem. */
  async resetPassword(id: string, newPassword: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('Para a sua própria senha, use "Meu acesso" (exige a senha atual)');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({ where: { id }, data: { passwordHash } });
      if (count === 0) throw new NotFoundException('Usuário não encontrado');
      await this.sessions.revokeAllForUser(id, tx);
    });
  }

  /**
   * Regra: o sistema nunca pode ficar sem um administrador ativo.
   *
   * Concorrência: dois admins tirando o papel um do outro AO MESMO TEMPO veriam, cada um,
   * "sobra outro admin" e ambos passariam. A trava consultiva serializa toda alteração que
   * pode remover um admin; a contagem vem DEPOIS, numa instrução nova, que em READ COMMITTED
   * enxerga o que a transação anterior acabou de confirmar.
   *
   * Por que não SELECT ... FOR UPDATE nas linhas dos admins? Ao reavaliar após a espera, o
   * Postgres relê só as linhas TRAVADAS (users); as do JOIN (user_roles) seguem da foto antiga,
   * e "tirar o papel" apaga uma linha de user_roles, não de users. O bug sobreviveria à trava.
   */
  private async assertKeepsAnAdmin(tx: Prisma.TransactionClient, targetId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('access:admin-roles'))`;
    const admins = await tx.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE r.key = 'ADMIN' AND u.active`;
    const targetIsAdmin = admins.some((a) => a.id === targetId);
    if (targetIsAdmin && admins.length === 1) {
      throw new ConflictException({
        code: 'LAST_ADMIN',
        message: 'Este é o último administrador ativo: o sistema não pode ficar sem nenhum',
      });
    }
  }

  async activate(id: string) {
    const { count } = await this.prisma.user.updateMany({ where: { id }, data: { active: true } });
    if (count === 0) throw new NotFoundException('Usuário não encontrado');
  }
}
