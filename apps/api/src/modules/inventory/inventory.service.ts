import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  isFractionalUnit,
  type Balance,
  type CreateAdjustmentInput,
  type CreateEntryInput,
  type Movement,
  type MovementListQuery,
  type MovementType,
  type Page,
  type Product,
  type ReverseMovementInput,
} from '@mini-erp/contracts';
import { uniqueViolationTarget } from '../../common/prisma-errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { ProductsService } from '../catalog/products/products.service.js';
import * as ledger from './stock-ledger.js';

export interface MovementResult {
  movement: Movement;
  /** true = a mesma Idempotency-Key já tinha sido processada; nada foi lançado de novo. */
  replayed: boolean;
}

/** O que identifica "a mesma operação" para fins de idempotência. */
interface Fingerprint {
  productId: string;
  type: MovementType;
  quantity: number;
  reversalOfId: string | null;
}

const movementInclude = {
  createdBy: { select: { id: true, name: true } },
  reversedBy: { select: { id: true } },
} satisfies Prisma.StockMovementInclude;

type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

const toMovement = (row: MovementRow): Movement => ({
  id: row.id,
  productId: row.productId,
  type: row.type,
  quantity: row.quantity.toNumber(),
  unitCostCents: row.unitCostCents,
  reason: row.reason as Movement['reason'],
  note: row.note,
  balanceAfter: row.balanceAfter.toNumber(),
  reversalOfId: row.reversalOfId,
  reversedById: row.reversedBy?.id ?? null,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

/** Quantidade como texto com 3 casas: é assim que vai para o NUMERIC do Postgres. */
const toQty = (n: number) => Math.abs(n).toFixed(3);

function insufficientStock(available: string): never {
  throw new ConflictException({
    code: 'INSUFFICIENT_STOCK',
    message: `Estoque insuficiente. Disponível: ${Number(available).toLocaleString('pt-BR')}`,
    available: Number(available),
  });
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  // ─── Escritas ────────────────────────────────────────────────────────────

  registerEntry(input: CreateEntryInput, userId: string, key: string): Promise<MovementResult> {
    const fp: Fingerprint = { productId: input.productId, type: 'ENTRY', quantity: input.quantity, reversalOfId: null };

    return this.idempotent(userId, key, fp, async () => {
      await this.assertMovable(input.productId, input.quantity);
      return this.prisma.$transaction(async (tx) => {
        const balance = await ledger.inflowWithCost(tx, input.productId, toQty(input.quantity), input.unitCostCents);
        return this.insertMovement(tx, {
          productId: input.productId,
          type: 'ENTRY',
          quantity: toQty(input.quantity),
          unitCostCents: input.unitCostCents,
          note: input.note,
          balanceAfter: balance.quantity,
          createdById: userId,
          idempotencyKey: key,
        });
      });
    });
  }

  registerAdjustment(input: CreateAdjustmentInput, userId: string, key: string): Promise<MovementResult> {
    const fp: Fingerprint = { productId: input.productId, type: 'ADJUSTMENT', quantity: input.quantity, reversalOfId: null };

    return this.idempotent(userId, key, fp, async () => {
      await this.assertMovable(input.productId, input.quantity);
      return this.prisma.$transaction(async (tx) => {
        const qty = toQty(input.quantity);
        const balance =
          input.quantity > 0
            ? await ledger.inflowAtCurrentCost(tx, input.productId, qty)
            : ((await ledger.outflow(tx, input.productId, qty)) ??
              insufficientStock(await ledger.currentQuantity(tx, input.productId)));

        return this.insertMovement(tx, {
          productId: input.productId,
          type: 'ADJUSTMENT',
          quantity: input.quantity > 0 ? qty : `-${qty}`,
          reason: input.reason,
          note: input.note,
          balanceAfter: balance.quantity,
          createdById: userId,
          idempotencyKey: key,
        });
      });
    });
  }

  /** Estorno: lança a movimentação inversa. A original continua intacta no histórico. */
  async reverse(movementId: string, input: ReverseMovementInput, userId: string, key: string): Promise<MovementResult> {
    const original = await this.prisma.stockMovement.findUnique({
      where: { id: movementId },
      include: { reversedBy: { select: { id: true } } },
    });
    if (!original) throw new NotFoundException('Movimentação não encontrada');

    const fp: Fingerprint = {
      productId: original.productId,
      type: 'REVERSAL',
      quantity: original.quantity.neg().toNumber(),
      reversalOfId: original.id,
    };

    return this.idempotent(userId, key, fp, async () => {
      if (original.type === 'REVERSAL') {
        throw new BadRequestException({ code: 'NOT_REVERSIBLE', message: 'Um estorno não pode ser estornado' });
      }
      if (original.type === 'SALE') {
        throw new BadRequestException({ code: 'NOT_REVERSIBLE', message: 'Saídas de venda são desfeitas cancelando a venda' });
      }
      if (original.reversedBy) this.alreadyReversed();

      const wasInflow = original.quantity.isPositive();
      const qty = original.quantity.abs().toFixed(3);

      try {
        return await this.prisma.$transaction(async (tx) => {
          let balance: ledger.BalanceAfter | null;
          if (!wasInflow) {
            balance = await ledger.inflowAtCurrentCost(tx, original.productId, qty);
          } else if (original.type === 'ENTRY') {
            balance = await ledger.reverseInflowWithCost(tx, original.productId, qty, original.unitCostCents!);
          } else {
            balance = await ledger.outflow(tx, original.productId, qty);
          }
          // Estornar uma entrada exige que a mercadoria ainda esteja no estoque.
          if (!balance) insufficientStock(await ledger.currentQuantity(tx, original.productId));

          return this.insertMovement(tx, {
            productId: original.productId,
            type: 'REVERSAL',
            quantity: wasInflow ? `-${qty}` : qty,
            note: input.note,
            balanceAfter: balance.quantity,
            reversalOfId: original.id,
            createdById: userId,
            idempotencyKey: key,
          });
        });
      } catch (err) {
        // Dois estornos simultâneos da mesma movimentação: o UNIQUE de reversal_of_id barra o segundo.
        if (uniqueViolationTarget(err)?.includes('reversal_of_id')) this.alreadyReversed();
        throw err;
      }
    });
  }

  // ─── Leituras ────────────────────────────────────────────────────────────

  async getBalances(productIds: string[]): Promise<Balance[]> {
    const rows = await this.prisma.stockBalance.findMany({ where: { productId: { in: productIds } } });
    const byId = new Map(rows.map((r) => [r.productId, r]));
    // Produto sem nenhuma movimentação ainda não tem linha de saldo: saldo zero.
    return [...new Set(productIds)].map((productId) => {
      const row = byId.get(productId);
      return {
        productId,
        quantity: row?.quantity.toNumber() ?? 0,
        avgCostCents: row?.avgCostCents.toNumber() ?? 0,
        totalValueCents: row ? row.quantity.mul(row.avgCostCents).toDecimalPlaces(0).toNumber() : 0,
      };
    });
  }

  async listMovements(query: MovementListQuery): Promise<Page<Movement>> {
    const where = { productId: query.productId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        include: movementInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toMovement), total, page: query.page, pageSize: query.pageSize };
  }

  // ─── Internos ────────────────────────────────────────────────────────────

  /** Regras do Catálogo consultadas pela interface pública dele (ADR 0001), não pela tabela. */
  private async assertMovable(productId: string, quantity: number): Promise<Product> {
    const product = await this.products.get(productId);
    if (product.status === 'ARCHIVED') {
      throw new ConflictException({ code: 'PRODUCT_ARCHIVED', message: 'Produto arquivado não pode ser movimentado' });
    }
    if (!isFractionalUnit(product.unit) && !Number.isInteger(quantity)) {
      throw new BadRequestException({
        message: 'Dados inválidos',
        errors: [{ path: 'quantity', message: `A unidade ${product.unit} não aceita quantidade fracionada` }],
      });
    }
    return product;
  }

  private async insertMovement(tx: Prisma.TransactionClient, data: Prisma.StockMovementUncheckedCreateInput) {
    const { id } = await tx.stockMovement.create({ data, select: { id: true } });
    return id;
  }

  /**
   * Idempotência (ADR 0010):
   * 1. A chave já existe para este usuário? Devolve a movimentação original (replay).
   * 2. Senão, executa. Se outra requisição com a mesma chave ganhou a corrida, o UNIQUE
   *    (created_by_id, idempotency_key) barra esta; toda a transação (inclusive o saldo)
   *    é desfeita e devolvemos a vencedora.
   * Mesma chave com dados diferentes = erro do cliente (422).
   */
  private async idempotent(
    userId: string,
    key: string,
    fp: Fingerprint,
    run: () => Promise<string>,
  ): Promise<MovementResult> {
    const existing = await this.findByKey(userId, key);
    if (existing) return this.replay(existing, fp);

    try {
      const id = await run();
      const row = await this.prisma.stockMovement.findUniqueOrThrow({ where: { id }, include: movementInclude });
      return { movement: toMovement(row), replayed: false };
    } catch (err) {
      if (uniqueViolationTarget(err)?.includes('idempotency')) {
        return this.replay((await this.findByKey(userId, key))!, fp);
      }
      throw err;
    }
  }

  private findByKey(userId: string, key: string) {
    return this.prisma.stockMovement.findUnique({
      where: { createdById_idempotencyKey: { createdById: userId, idempotencyKey: key } },
      include: movementInclude,
    });
  }

  private replay(row: MovementRow, fp: Fingerprint): MovementResult {
    const same =
      row.productId === fp.productId &&
      row.type === fp.type &&
      row.quantity.toNumber() === fp.quantity &&
      row.reversalOfId === fp.reversalOfId;
    if (!same) {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Esta Idempotency-Key já foi usada em outra operação. Gere uma nova chave.',
      });
    }
    return { movement: toMovement(row), replayed: true };
  }

  private alreadyReversed(): never {
    throw new ConflictException({ code: 'ALREADY_REVERSED', message: 'Esta movimentação já foi estornada' });
  }
}
