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
  type CancelSaleInput,
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
import { ProductsService } from '../catalog/products/products.service.js';
import { InventoryService } from '../inventory/inventory.service.js';

/** Teto por venda: folga abaixo do INTEGER do Postgres (~2,1 bi de centavos). */
const MAX_SALE_CENTS = 1_000_000_000;

const userRef = { select: { id: true, name: true } } as const;

const saleInclude = {
  items: { orderBy: { position: 'asc' } },
  createdBy: userRef,
  canceledBy: userRef,
} satisfies Prisma.SaleInclude;

type SaleRow = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

const toSale = (row: SaleRow): Sale => ({
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
  })),
  subtotalCents: row.subtotalCents,
  discountCents: row.discountCents,
  totalCents: row.totalCents,
  paymentMethod: row.paymentMethod,
  receivedCents: row.receivedCents,
  changeCents: row.changeCents,
  note: row.note,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  canceledAt: row.canceledAt?.toISOString() ?? null,
  canceledBy: row.canceledBy,
  cancelReason: row.cancelReason,
});

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
        const sale = await tx.sale.create({
          data: {
            subtotalCents: totals.subtotalCents,
            discountCents: totals.discountCents,
            totalCents: totals.totalCents,
            paymentMethod: input.payment.method,
            receivedCents: payment.receivedCents,
            changeCents: payment.changeCents,
            note: input.note,
            createdById: userId,
            idempotencyKey: key,
          },
          select: { id: true, number: true },
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
      const { count } = await tx.sale.updateMany({
        where: { id, status: 'COMPLETED' },
        data: { status: 'CANCELED', canceledAt: new Date(), canceledById: userId, cancelReason: input.reason },
      });
      if (count === 0) {
        const exists = await tx.sale.count({ where: { id } });
        if (!exists) throw new NotFoundException('Venda não encontrada');
        throw new ConflictException({ code: 'ALREADY_CANCELED', message: 'Esta venda já foi cancelada' });
      }

      const sale = await tx.sale.findUniqueOrThrow({ where: { id }, select: { number: true } });
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
    });
    return this.get(id);
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
        include: { createdBy: userRef, _count: { select: { items: true } } },
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
        paymentMethod: r.paymentMethod,
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

  /** Só dinheiro tem troco; nos demais meios o recebido é exatamente o total (D28). */
  private settlePayment(input: CreateSaleInput, totalCents: number) {
    if (input.payment.method !== 'CASH') return { receivedCents: totalCents, changeCents: 0 };
    const receivedCents = input.payment.receivedCents ?? totalCents;
    if (receivedCents < totalCents) invalid('payment.receivedCents', 'Valor recebido menor que o total');
    return { receivedCents, changeCents: receivedCents - totalCents };
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
    const same =
      row.paymentMethod === input.payment.method &&
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
