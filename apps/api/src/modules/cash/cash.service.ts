import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CashMovement,
  CashMovementInput,
  CashSession,
  CashSessionListQuery,
  CashSessionSummary,
  CloseCashInput,
  OpenCashInput,
  Page,
  PaymentMethod,
} from '@mini-erp/contracts';
import { uniqueViolationTarget } from '../../common/prisma-errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { AuthContext } from '../access/auth-context.js';

type Tx = Prisma.TransactionClient;

const userRef = { select: { id: true, name: true } } as const;

const sessionInclude = {
  operator: userRef,
  closedBy: userRef,
  _count: { select: { sales: { where: { status: 'COMPLETED' } } } },
} satisfies Prisma.CashSessionInclude;

type SessionRow = Prisma.CashSessionGetPayload<{
  include: typeof sessionInclude;
}>;

const movementInclude = {
  createdBy: userRef,
  sale: { select: { number: true } },
} satisfies Prisma.CashMovementInclude;

type MovementRow = Prisma.CashMovementGetPayload<{
  include: typeof movementInclude;
}>;

const toMovement = (row: MovementRow): CashMovement => ({
  id: row.id,
  type: row.type,
  amountCents: row.amountCents,
  note: row.note,
  saleNumber: row.sale?.number ?? null,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

const toSummary = (row: SessionRow, expectedCents: number | null): CashSessionSummary => ({
  id: row.id,
  number: row.number,
  operator: row.operator,
  openedAt: row.openedAt.toISOString(),
  openingCents: row.openingCents,
  salesCount: row._count.sales,
  closedAt: row.closedAt?.toISOString() ?? null,
  closedBy: row.closedBy,
  countedCents: row.countedCents,
  differenceCents: row.differenceCents,
  closingNote: row.closingNote,
  expectedCents,
});

function sessionRequired(message: string): never {
  throw new ConflictException({ code: 'CASH_SESSION_REQUIRED', message });
}

/** Valores de quem vê o esperado: gerente sempre; o operador só depois de fechar (fechamento cego, D46). */
const canSeeExpected = (auth: AuthContext, row: { operatorId: string; closedAt: Date | null }) =>
  auth.permissions.has('caixa:gerenciar') || (row.operatorId === auth.user.id && row.closedAt !== null);

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Operação do caixa ───────────────────────────────────────────────────

  async open(input: OpenCashInput, auth: AuthContext): Promise<CashSession> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const session = await tx.cashSession.create({
          data: { operatorId: auth.user.id, openingCents: input.openingCents },
          select: { id: true },
        });
        await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            type: 'OPENING',
            amountCents: input.openingCents,
            note: input.note,
            createdById: auth.user.id,
          },
        });
        return session.id;
      });
      return this.get(id, auth);
    } catch (err) {
      // O índice único parcial garante UM caixa aberto por operador, mesmo com dois cliques simultâneos.
      if (uniqueViolationTarget(err)?.includes('one_open_per_operator')) {
        throw new ConflictException({
          code: 'CASH_ALREADY_OPEN',
          message: 'Você já tem um caixa aberto',
        });
      }
      throw err;
    }
  }

  async current(auth: AuthContext): Promise<CashSession | null> {
    const row = await this.prisma.cashSession.findFirst({
      where: { operatorId: auth.user.id, closedAt: null },
      select: { id: true },
    });
    return row ? this.get(row.id, auth) : null;
  }

  /** Suprimento ou sangria no caixa aberto de quem chama. Idempotente, como as escritas de estoque. */
  async addMovement(input: CashMovementInput, auth: AuthContext, key: string): Promise<CashMovement> {
    const userId = auth.user.id;
    const existing = await this.findMovementByKey(userId, key);
    if (existing) return this.replayMovement(existing, input);

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        // FOR UPDATE: duas sangrias simultâneas não podem, cada uma, "ver" o mesmo dinheiro na gaveta.
        const [session] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM cash_sessions WHERE operator_id = ${userId}::uuid AND closed_at IS NULL FOR UPDATE`;
        if (!session) sessionRequired('Abra o caixa antes de registrar suprimento ou sangria');

        if (input.type === 'WITHDRAWAL' && (await this.expected(tx, session.id)) < input.amountCents) {
          // Sem dizer quanto há na gaveta: o operador não vê o esperado (D46).
          throw new UnprocessableEntityException({
            code: 'INSUFFICIENT_CASH',
            message: 'A sangria é maior que o dinheiro registrado no caixa',
          });
        }
        const movement = await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            type: input.type,
            amountCents: input.type === 'WITHDRAWAL' ? -input.amountCents : input.amountCents,
            note: input.note,
            createdById: userId,
            idempotencyKey: key,
          },
          select: { id: true },
        });
        return movement.id;
      });
      return toMovement(
        await this.prisma.cashMovement.findUniqueOrThrow({
          where: { id },
          include: movementInclude,
        }),
      );
    } catch (err) {
      if (uniqueViolationTarget(err)?.includes('idempotency')) {
        return this.replayMovement((await this.findMovementByKey(userId, key))!, input);
      }
      throw err;
    }
  }

  /**
   * Fechamento (D46). O FOR UPDATE espera as vendas em andamento nesta sessão terminarem (elas
   * seguram a sessão com FOR SHARE); as que chegarem depois encontram o caixa fechado. Assim o
   * esperado gravado é exatamente a soma do livro do caixa, sem venda "no meio".
   * `sessionId` nulo = o caixa aberto de quem chama.
   */
  async close(sessionId: string | null, input: CloseCashInput, auth: AuthContext): Promise<CashSession> {
    const id = await this.prisma.$transaction(async (tx) => {
      const [session] =
        sessionId === null
          ? await tx.$queryRaw<{ id: string; operator_id: string }[]>`
              SELECT id, operator_id FROM cash_sessions
              WHERE operator_id = ${auth.user.id}::uuid AND closed_at IS NULL FOR UPDATE`
          : await tx.$queryRaw<{ id: string; operator_id: string }[]>`
              SELECT id, operator_id FROM cash_sessions WHERE id = ${sessionId}::uuid AND closed_at IS NULL FOR UPDATE`;

      if (!session) {
        if (sessionId === null) sessionRequired('Você não tem caixa aberto');
        const exists = await tx.cashSession.count({ where: { id: sessionId } });
        if (!exists) throw new NotFoundException('Caixa não encontrado');
        throw new ConflictException({
          code: 'CASH_ALREADY_CLOSED',
          message: 'Este caixa já foi fechado',
        });
      }
      // Fechar o caixa de OUTRA pessoa (que esqueceu de fechar) é coisa de gerente.
      if (session.operator_id !== auth.user.id && !auth.permissions.has('caixa:gerenciar')) {
        throw new ForbiddenException('Só o próprio operador ou um gerente fecha este caixa');
      }

      const expectedCents = await this.expected(tx, session.id);
      await tx.cashSession.update({
        where: { id: session.id },
        data: {
          closedAt: new Date(),
          closedById: auth.user.id,
          expectedCents,
          countedCents: input.countedCents,
          differenceCents: input.countedCents - expectedCents,
          closingNote: input.note,
        },
      });
      return session.id;
    });
    return this.get(id, auth);
  }

  // ─── Consultas ───────────────────────────────────────────────────────────

  async get(id: string, auth: AuthContext): Promise<CashSession> {
    const row = await this.prisma.cashSession.findUnique({
      where: { id },
      include: sessionInclude,
    });
    if (!row) throw new NotFoundException('Caixa não encontrado');
    if (row.operatorId !== auth.user.id && !auth.permissions.has('caixa:gerenciar')) {
      throw new NotFoundException('Caixa não encontrado'); // 404, não 403: não confirma que o caixa existe.
    }
    const { expectedCents: _, ...summary } = toSummary(row, null);
    if (!canSeeExpected(auth, row)) return { ...summary, totals: null };

    const [movements, byMethod] = await Promise.all([
      this.prisma.cashMovement.findMany({
        where: { sessionId: id },
        include: movementInclude,
        orderBy: { createdAt: 'asc' },
      }),
      this.salesByMethod(id),
    ]);
    const expectedCents = row.expectedCents ?? movements.reduce((a, m) => a + m.amountCents, 0);
    return {
      ...summary,
      totals: { expectedCents, byMethod, movements: movements.map(toMovement) },
    };
  }

  async list(query: CashSessionListQuery): Promise<Page<CashSessionSummary>> {
    const where: Prisma.CashSessionWhereInput =
      query.status === 'ALL' ? {} : { closedAt: query.status === 'OPEN' ? null : { not: null } };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.cashSession.count({ where }),
      this.prisma.cashSession.findMany({
        where,
        include: sessionInclude,
        orderBy: { openedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    // Esperado dos caixas ainda abertos: soma do livro, numa consulta só para a página inteira.
    const open = rows.filter((r) => r.closedAt === null).map((r) => r.id);
    const sums = open.length
      ? await this.prisma.cashMovement.groupBy({
          by: ['sessionId'],
          where: { sessionId: { in: open } },
          _sum: { amountCents: true },
        })
      : [];
    const live = new Map(sums.map((s) => [s.sessionId, s._sum.amountCents ?? 0]));
    return {
      items: rows.map((r) => toSummary(r, r.expectedCents ?? live.get(r.id) ?? 0)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ─── Interface para Vendas (roda DENTRO da transação da venda) ────────────

  /**
   * Caixa aberto do operador, travado com FOR SHARE até o fim da transação da venda:
   * várias vendas simultâneas convivem, mas o fechamento espera todas terminarem.
   */
  async lockOpenSession(tx: Tx, operatorId: string): Promise<string> {
    const [session] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cash_sessions WHERE operator_id = ${operatorId}::uuid AND closed_at IS NULL FOR SHARE`;
    if (!session) sessionRequired('Abra o caixa antes de vender');
    return session.id;
  }

  async recordSaleCash(
    tx: Tx,
    args: {
      sessionId: string;
      saleId: string;
      amountCents: number;
      userId: string;
    },
  ) {
    if (args.amountCents <= 0) return;
    await tx.cashMovement.create({
      data: {
        sessionId: args.sessionId,
        type: 'SALE',
        amountCents: args.amountCents,
        saleId: args.saleId,
        createdById: args.userId,
      },
    });
  }

  /**
   * Dinheiro devolvido ao cliente (cancelamento ou devolução, D47). Sai da gaveta da própria
   * venda se aquele caixa ainda estiver aberto (o caso comum: "registrei errado"); senão, da
   * gaveta de quem está devolvendo. Sem gaveta aberta não há de onde tirar o dinheiro.
   */
  async recordCashOut(
    tx: Tx,
    args: {
      type: 'SALE_CANCEL' | 'REFUND';
      saleSessionId: string | null;
      saleId: string;
      amountCents: number;
      userId: string;
      note: string;
    },
  ) {
    if (args.amountCents <= 0) return;
    const [session] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cash_sessions
      WHERE closed_at IS NULL AND (id = ${args.saleSessionId}::uuid OR operator_id = ${args.userId}::uuid)
      ORDER BY (id = ${args.saleSessionId}::uuid) DESC NULLS LAST
      LIMIT 1 FOR SHARE`;
    if (!session) sessionRequired('Para devolver dinheiro ao cliente, abra o seu caixa: o valor sai da gaveta');
    await tx.cashMovement.create({
      data: {
        sessionId: session.id,
        type: args.type,
        amountCents: -args.amountCents,
        saleId: args.saleId,
        note: args.note,
        createdById: args.userId,
      },
    });
  }

  // ─── Internos ────────────────────────────────────────────────────────────

  private async expected(tx: Tx, sessionId: string): Promise<number> {
    const { _sum } = await tx.cashMovement.aggregate({
      where: { sessionId },
      _sum: { amountCents: true },
    });
    return _sum.amountCents ?? 0;
  }

  /** Vendas concluídas da sessão por forma de pagamento. Em dinheiro, o líquido (entregue − troco). */
  private async salesByMethod(sessionId: string): Promise<{ method: PaymentMethod; amountCents: number }[]> {
    const rows = await this.prisma.$queryRaw<{ method: PaymentMethod; amount: bigint }[]>`
      SELECT p.method::text AS method,
             sum(CASE WHEN p.method = 'CASH' THEN p.amount_cents - s.change_cents ELSE p.amount_cents END)::bigint AS amount
      FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.cash_session_id = ${sessionId}::uuid AND s.status = 'COMPLETED'
      GROUP BY p.method ORDER BY p.method`;
    return rows.map((r) => ({
      method: r.method,
      amountCents: Number(r.amount),
    }));
  }

  private findMovementByKey(userId: string, key: string) {
    return this.prisma.cashMovement.findUnique({
      where: {
        createdById_idempotencyKey: {
          createdById: userId,
          idempotencyKey: key,
        },
      },
      include: movementInclude,
    });
  }

  private replayMovement(row: MovementRow, input: CashMovementInput): CashMovement {
    const signed = input.type === 'WITHDRAWAL' ? -input.amountCents : input.amountCents;
    if (row.type !== input.type || row.amountCents !== signed) {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Esta Idempotency-Key já foi usada em outra operação. Gere uma nova chave.',
      });
    }
    return toMovement(row);
  }
}
