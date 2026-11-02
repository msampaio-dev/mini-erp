import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  computeSaleTotals,
  isFractionalUnit,
  returnRefundCents,
  settlePayments,
  type CancelSaleInput,
  type CreateReturnInput,
  type CreateSaleInput,
  type Page,
  type Product,
  type Sale,
  type SaleListQuery,
  type SaleSummary,
  type SaleTotals,
} from '@mini-erp/contracts';
import { uniqueViolationTarget } from '../../common/prisma-errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { CashService } from '../cash/cash.service.js';
import { ProductsService } from '../catalog/products/products.service.js';
import { InventoryService } from '../inventory/inventory.service.js';

/** Teto por venda: folga abaixo do INTEGER do Postgres (~2,1 bi de centavos). */
const MAX_SALE_CENTS = 1_000_000_000;

const userRef = { select: { id: true, name: true } } as const;

const saleInclude = {
  items: { orderBy: { position: 'asc' } },
  payments: { orderBy: { method: 'asc' } },
  createdBy: userRef,
  canceledBy: userRef,
  returns: { orderBy: { createdAt: 'asc' }, include: { createdBy: userRef, items: true } },
} satisfies Prisma.SaleInclude;

type SaleRow = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

/** Quanto de cada item de venda já voltou, somando todas as devoluções. */
function returnedBySaleItem(row: SaleRow) {
  const totals = new Map<string, { quantity: number; refundCents: number }>();
  for (const r of row.returns) {
    for (const i of r.items) {
      const t = totals.get(i.saleItemId) ?? { quantity: 0, refundCents: 0 };
      // Milésimos inteiros: somar 0,1 + 0,2 em float daria 0,30000000000000004.
      t.quantity = (Math.round(t.quantity * 1000) + Math.round(i.quantity.toNumber() * 1000)) / 1000;
      t.refundCents += i.refundCents;
      totals.set(i.saleItemId, t);
    }
  }
  return totals;
}

const toSale = (row: SaleRow): Sale => {
  const returned = returnedBySaleItem(row);
  const byItemId = new Map(row.items.map((i) => [i.id, i]));
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    // Custo (unitCostCents) fica fora da resposta: margem é dado gerencial (Fase 6, relatorios:ler).
    items: row.items.map((i) => ({
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      unit: i.unit,
      quantity: i.quantity.toNumber(),
      unitPriceCents: i.unitPriceCents,
      grossCents: i.grossCents,
      discountCents: i.discountCents,
      netCents: i.netCents,
      returnedQuantity: returned.get(i.id)?.quantity ?? 0,
      refundedCents: returned.get(i.id)?.refundCents ?? 0,
    })),
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    totalCents: row.totalCents,
    payments: row.payments.map((p) => ({ method: p.method, amountCents: p.amountCents })),
    receivedCents: row.receivedCents,
    changeCents: row.changeCents,
    note: row.note,
    cashSessionId: row.cashSessionId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    canceledAt: row.canceledAt?.toISOString() ?? null,
    canceledBy: row.canceledBy,
    cancelReason: row.cancelReason,
    returns: row.returns.map((r) => ({
      id: r.id,
      number: r.number,
      reason: r.reason,
      refundMethod: r.refundMethod,
      refundCents: r.refundCents,
      restock: r.restock,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      items: r.items.map((i) => {
        const item = byItemId.get(i.saleItemId)!;
        return {
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          quantity: i.quantity.toNumber(),
          refundCents: i.refundCents,
        };
      }),
    })),
  };
};

export interface SaleResult {
  sale: Sale;
  replayed: boolean;
}

function invalid(path: string, message: string): never {
  throw new BadRequestException({ message: 'Dados inválidos', errors: [{ path, message }] });
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly inventory: InventoryService,
    private readonly cash: CashService,
  ) {}

  async create(input: CreateSaleInput, userId: string, key: string): Promise<SaleResult> {
    const existing = await this.findByKey(userId, key);
    if (existing) return this.replay(existing, input);

    const products = await this.loadSellableProducts(input);
    // Preço vem do catálogo, nunca do cliente.
    const lines = input.items.map((item) => ({
      item,
      product: products.get(item.productId)!,
    }));
    const totals = this.computeTotals(lines, input);
    const payment = this.settlePayment(input, totals.totalCents);

    try {
      const saleId = await this.prisma.$transaction(async (tx) => {
        // Primeiro lock da venda: o caixa (D44). Toda venda tem dono e gaveta.
        const cashSessionId = await this.cash.lockOpenSession(tx, userId);
        const sale = await tx.sale.create({
          data: {
            subtotalCents: totals.subtotalCents,
            discountCents: totals.discountCents,
            totalCents: totals.totalCents,
            receivedCents: payment.receivedCents,
            changeCents: payment.changeCents,
            note: input.note,
            createdById: userId,
            idempotencyKey: key,
            cashSessionId,
            payments: { create: input.payments.filter((p) => p.amountCents > 0) },
          },
          select: { id: true, number: true },
        });
        await this.cash.recordSaleCash(tx, {
          sessionId: cashSessionId,
          saleId: sale.id,
          amountCents: payment.cashNetCents,
          userId,
        });

        // ORDEM FIXA DE LOCKS (D23): baixa sempre em ordem de productId. Sem isso, a venda
        // [A, B] e a venda [B, A] simultâneas podem travar uma esperando a outra (deadlock):
        // a 1ª segura A e espera B; a 2ª segura B e espera A.
        const ordered = lines
          .map((line, position) => ({ ...line, position }))
          .sort((a, b) => (a.product.id < b.product.id ? -1 : 1));

        const items: Prisma.SaleItemCreateManyInput[] = [];
        for (const { item, product, position } of ordered) {
          const { movementId, unitCostCents } = await this.inventory.recordSaleOutflow(tx, {
            productId: product.id,
            sku: product.sku,
            quantity: item.quantity,
            userId,
            note: `Venda nº ${sale.number}`,
          });
          const amounts = totals.lines[position]!;
          items.push({
            saleId: sale.id,
            position,
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unit: product.unit,
            quantity: item.quantity.toFixed(3),
            unitPriceCents: product.salePriceCents,
            grossCents: amounts.grossCents,
            discountCents: amounts.discountCents,
            netCents: amounts.netCents,
            unitCostCents,
            categoryId: product.category?.id ?? null,
            categoryName: product.category?.name ?? null,
            stockMovementId: movementId,
          });
        }
        await tx.saleItem.createMany({ data: items });
        return sale.id;
      });

      return { sale: await this.get(saleId), replayed: false };
    } catch (err) {
      // Mesma Idempotency-Key em paralelo: a outra venceu; esta foi desfeita por inteiro.
      if (uniqueViolationTarget(err)?.includes('idempotency')) {
        return this.replay((await this.findByKey(userId, key))!, input);
      }
      throw err;
    }
  }

  /**
   * Cancelamento (D27): muda o status E devolve o estoque na mesma transação.
   * O UPDATE ... WHERE status = 'COMPLETED' é a trava: dois cancelamentos simultâneos,
   * só um encontra a venda ainda concluída.
   */
  async cancel(id: string, input: CancelSaleInput, userId: string): Promise<Sale> {
    await this.prisma.$transaction(async (tx) => {
      // Trava a venda antes de olhar as devoluções: uma devolução simultânea (que também trava a
      // venda) termina antes ou começa depois, nunca no meio.
      await tx.$queryRaw`SELECT id FROM sales WHERE id = ${id}::uuid FOR UPDATE`;
      if (await tx.saleReturn.count({ where: { saleId: id } })) {
        throw new ConflictException({
          code: 'SALE_HAS_RETURNS',
          message: 'Esta venda já tem devolução: registre outra devolução para os itens restantes',
        });
      }
      const { count } = await tx.sale.updateMany({
        where: { id, status: 'COMPLETED' },
        data: { status: 'CANCELED', canceledAt: new Date(), canceledById: userId, cancelReason: input.reason },
      });
      if (count === 0) {
        const exists = await tx.sale.count({ where: { id } });
        if (!exists) throw new NotFoundException('Venda não encontrada');
        throw new ConflictException({ code: 'ALREADY_CANCELED', message: 'Esta venda já foi cancelada' });
      }

      const sale = await tx.sale.findUniqueOrThrow({
        where: { id },
        select: { number: true, cashSessionId: true, changeCents: true, payments: { where: { method: 'CASH' } } },
      });
      // Mesma ordem de locks da criação.
      const items = await tx.saleItem.findMany({ where: { saleId: id }, orderBy: { productId: 'asc' } });
      for (const item of items) {
        await this.inventory.reverseSaleOutflow(tx, {
          movementId: item.stockMovementId,
          productId: item.productId,
          quantity: item.quantity.toNumber(),
          userId,
          note: `Cancelamento da venda nº ${sale.number}: ${input.reason}`,
        });
      }
      // O dinheiro que tinha ficado na gaveta volta para o cliente (D47).
      await this.cash.recordCashOut(tx, {
        type: 'SALE_CANCEL',
        saleSessionId: sale.cashSessionId,
        saleId: id,
        amountCents: (sale.payments[0]?.amountCents ?? 0) - sale.changeCents,
        userId,
        note: `Cancelamento da venda nº ${sale.number}`,
      });
    });
    return this.get(id);
  }

  /**
   * Devolução parcial (ADR 0019). A venda fica travada (FOR UPDATE) durante a devolução: duas
   * devoluções simultâneas da mesma venda, ou devolução × cancelamento, acontecem uma de cada vez,
   * e a conta "quanto ainda pode voltar" é feita com o saldo já atualizado.
   */
  async createReturn(saleId: string, input: CreateReturnInput, userId: string, key: string): Promise<SaleResult> {
    const existing = await this.findReturnByKey(userId, key);
    if (existing) return this.replayReturn(existing, saleId, input);

    try {
      await this.prisma.$transaction(async (tx) => {
        const [sale] = await tx.$queryRaw<{ status: string; number: number; cash_session_id: string | null }[]>`
          SELECT status, number, cash_session_id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
        if (!sale) throw new NotFoundException('Venda não encontrada');
        if (sale.status !== 'COMPLETED') {
          throw new ConflictException({ code: 'SALE_CANCELED', message: 'Venda cancelada não tem devolução' });
        }

        // Lido DEPOIS do lock: inclui as devoluções que terminaram enquanto esta esperava.
        const row = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: saleInclude });
        const returned = returnedBySaleItem(row);
        const lines = input.items.map((req, i) => {
          const item = row.items.find((it) => it.productId === req.productId);
          if (!item) invalid(`items.${i}.productId`, 'Este produto não está na venda');
          if (!isFractionalUnit(item.unit) && !Number.isInteger(req.quantity)) {
            invalid(`items.${i}.quantity`, `A unidade ${item.unit} não aceita quantidade fracionada`);
          }
          const already = returned.get(item.id) ?? { quantity: 0, refundCents: 0 };
          const remaining = (Math.round(item.quantity.toNumber() * 1000) - Math.round(already.quantity * 1000)) / 1000;
          if (req.quantity > remaining) {
            throw new UnprocessableEntityException({
              code: 'RETURN_EXCEEDS_SOLD',
              message: `${item.name}: só ${remaining.toLocaleString('pt-BR')} ${item.unit} ainda pode(m) ser devolvido(s)`,
              productId: item.productId,
              remaining,
            });
          }
          const refundCents = returnRefundCents(
            {
              netCents: item.netCents,
              quantity: item.quantity.toNumber(),
              returnedQuantity: already.quantity,
              refundedCents: already.refundCents,
            },
            req.quantity,
          );
          return { item, quantity: req.quantity, refundCents };
        });
        const refundCents = lines.reduce((a, l) => a + l.refundCents, 0);

        const created = await tx.saleReturn.create({
          data: {
            saleId,
            reason: input.reason,
            refundMethod: input.refundMethod,
            refundCents,
            restock: input.restock,
            createdById: userId,
            idempotencyKey: key,
          },
          select: { id: true, number: true },
        });
        const note = `Devolução nº ${created.number} da venda nº ${sale.number}`;

        // Mesma ordem de locks das vendas (D23): por produto.
        for (const line of [...lines].sort((a, b) => (a.item.productId < b.item.productId ? -1 : 1))) {
          const stockMovementId = input.restock
            ? await this.inventory.recordReturnInflow(tx, {
                productId: line.item.productId,
                quantity: line.quantity,
                userId,
                note,
              })
            : null;
          await tx.saleReturnItem.create({
            data: {
              returnId: created.id,
              saleItemId: line.item.id,
              quantity: line.quantity.toFixed(3),
              refundCents: line.refundCents,
              stockMovementId,
            },
          });
        }

        if (input.refundMethod === 'CASH') {
          await this.cash.recordCashOut(tx, {
            type: 'REFUND',
            saleSessionId: sale.cash_session_id,
            saleId,
            amountCents: refundCents,
            userId,
            note,
          });
        }
      });
      return { sale: await this.get(saleId), replayed: false };
    } catch (err) {
      if (uniqueViolationTarget(err)?.includes('idempotency')) {
        return this.replayReturn((await this.findReturnByKey(userId, key))!, saleId, input);
      }
      throw err;
    }
  }

  async get(id: string): Promise<Sale> {
    const row = await this.prisma.sale.findUnique({ where: { id }, include: saleInclude });
    if (!row) throw new NotFoundException('Venda não encontrada');
    return toSale(row);
  }

  async list(query: SaleListQuery): Promise<Page<SaleSummary>> {
    const where: Prisma.SaleWhereInput = {
      ...(query.status !== 'ALL' && { status: query.status }),
      ...(query.number && { number: query.number }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        include: { createdBy: userRef, payments: { orderBy: { method: 'asc' } }, _count: { select: { items: true } } },
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        subtotalCents: r.subtotalCents,
        discountCents: r.discountCents,
        totalCents: r.totalCents,
        payments: r.payments.map((p) => ({ method: p.method, amountCents: p.amountCents })),
        receivedCents: r.receivedCents,
        changeCents: r.changeCents,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        canceledAt: r.canceledAt?.toISOString() ?? null,
        itemCount: r._count.items,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ─── Internos ────────────────────────────────────────────────────────────

  private async loadSellableProducts(input: CreateSaleInput): Promise<Map<string, Product>> {
    const found = new Map((await this.products.getMany(input.items.map((i) => i.productId))).map((p) => [p.id, p]));
    input.items.forEach((item, i) => {
      const product = found.get(item.productId);
      if (!product) invalid(`items.${i}.productId`, 'Produto não encontrado');
      if (product.status === 'ARCHIVED') {
        throw new ConflictException({
          code: 'PRODUCT_ARCHIVED',
          message: `O produto ${product.sku} está arquivado e não pode ser vendido`,
        });
      }
      if (!isFractionalUnit(product.unit) && !Number.isInteger(item.quantity)) {
        invalid(`items.${i}.quantity`, `A unidade ${product.unit} de ${product.sku} não aceita quantidade fracionada`);
      }
    });
    return found;
  }

  private computeTotals(lines: { item: { quantity: number }; product: Product }[], input: CreateSaleInput): SaleTotals {
    let totals: SaleTotals;
    try {
      totals = computeSaleTotals(
        lines.map(({ item, product }) => ({ quantity: item.quantity, unitPriceCents: product.salePriceCents })),
        input.discount,
      );
    } catch (err) {
      if (err instanceof RangeError) invalid('discount', err.message);
      throw err;
    }
    if (totals.subtotalCents > MAX_SALE_CENTS) {
      throw new UnprocessableEntityException({ code: 'SALE_TOO_LARGE', message: 'Valor da venda acima do limite' });
    }
    return totals;
  }

  /** Pagamento dividido (D45): a regra é a mesma função que o PDV usa para a prévia. */
  private settlePayment(input: CreateSaleInput, totalCents: number) {
    try {
      return settlePayments(totalCents, input.payments);
    } catch (err) {
      if (err instanceof RangeError) invalid('payments', err.message);
      throw err;
    }
  }

  private findReturnByKey(userId: string, key: string) {
    return this.prisma.saleReturn.findUnique({
      where: { createdById_idempotencyKey: { createdById: userId, idempotencyKey: key } },
      include: { items: { include: { saleItem: { select: { productId: true } } } } },
    });
  }

  /** Mesma chave = mesma devolução: confere venda e itens antes de devolver o resultado original. */
  private async replayReturn(
    row: NonNullable<Awaited<ReturnType<SalesService['findReturnByKey']>>>,
    saleId: string,
    input: CreateReturnInput,
  ): Promise<SaleResult> {
    const asKey = (items: { productId: string; quantity: number }[]) =>
      items
        .map((i) => `${i.productId}:${i.quantity}`)
        .sort()
        .join('|');
    const same =
      row.saleId === saleId &&
      asKey(row.items.map((i) => ({ productId: i.saleItem.productId, quantity: i.quantity.toNumber() }))) ===
        asKey(input.items);
    if (!same) {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Esta Idempotency-Key já foi usada em outra operação. Gere uma nova chave.',
      });
    }
    return { sale: await this.get(saleId), replayed: true };
  }

  private findByKey(userId: string, key: string) {
    return this.prisma.sale.findUnique({
      where: { createdById_idempotencyKey: { createdById: userId, idempotencyKey: key } },
      include: saleInclude,
    });
  }

  /** Mesma chave = mesma venda: confere itens e pagamento antes de devolver a original. */
  private replay(row: SaleRow, input: CreateSaleInput): SaleResult {
    const asKey = (items: { productId: string; quantity: number }[]) =>
      items
        .map((i) => `${i.productId}:${i.quantity}`)
        .sort()
        .join('|');
    const asPayKey = (list: { method: string; amountCents: number }[]) =>
      list
        .filter((p) => p.amountCents > 0)
        .map((p) => `${p.method}:${p.amountCents}`)
        .sort()
        .join('|');
    const same =
      asPayKey(row.payments) === asPayKey(input.payments) &&
      asKey(row.items.map((i) => ({ productId: i.productId, quantity: i.quantity.toNumber() }))) === asKey(input.items);
    if (!same) {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Esta Idempotency-Key já foi usada em outra venda. Gere uma nova chave.',
      });
    }
    return { sale: toSale(row), replayed: true };
  }
}
