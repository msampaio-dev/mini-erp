import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateProductInput,
  Page,
  Product,
  ProductListQuery,
  ProductStatus,
  UpdateProductInput,
} from '@mini-erp/contracts';
import {
  isForeignKeyViolation,
  isRecordNotFound,
  uniqueViolationTarget,
} from '../../../common/prisma-errors.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

const productInclude = {
  category: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  description: row.description,
  unit: row.unit,
  barcode: row.barcode,
  category: row.category,
  salePriceCents: row.salePriceCents,
  minStock: row.minStock.toNumber(),
  status: row.status,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Traduz violações de constraint do banco em erros HTTP com mensagem de negócio. */
function mapWriteError(err: unknown): never {
  const target = uniqueViolationTarget(err);
  if (target?.includes('barcode')) throw new ConflictException('Já existe um produto com este código de barras');
  if (target !== null) throw new ConflictException('Já existe um produto com este SKU');
  if (isForeignKeyViolation(err)) throw new BadRequestException('Categoria não encontrada');
  throw err;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ProductListQuery): Promise<Page<Product>> {
    const where: Prisma.ProductWhereInput = {
      ...(query.status !== 'ALL' && { status: query.status }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      // ILIKE '%termo%': acelerado pelos índices trigram (pg_trgm) de name e sku.
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { sku: { contains: query.q, mode: 'insensitive' } },
          { barcode: query.q },
        ],
      }),
    };

    // Contagem e página na mesma transação: o total bate com os itens retornados.
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: productInclude,
        // id como desempate: ordem estável mesmo com nomes iguais (sem itens pulando de página).
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { items: rows.map(toProduct), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string): Promise<Product> {
    const row = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!row) throw new NotFoundException('Produto não encontrado');
    return toProduct(row);
  }

  async create(input: CreateProductInput): Promise<Product> {
    try {
      const row = await this.prisma.product.create({ data: input, include: productInclude });
      return toProduct(row);
    } catch (err) {
      mapWriteError(err);
    }
  }

  /**
   * Optimistic locking (ADR 0009): só grava se a versão no banco ainda for a que
   * o usuário viu ao abrir o formulário. O WHERE id AND version + incremento é atômico:
   * duas edições simultâneas nunca passam ambas.
   */
  async update(id: string, { version, ...data }: UpdateProductInput): Promise<Product> {
    let count: number;
    try {
      ({ count } = await this.prisma.product.updateMany({
        where: { id, version },
        data: { ...data, version: { increment: 1 } },
      }));
    } catch (err) {
      mapWriteError(err);
    }

    if (count === 0) {
      const exists = await this.prisma.product.count({ where: { id } });
      if (!exists) throw new NotFoundException('Produto não encontrado');
      // `code` legível por máquina: o front decide o que fazer sem depender do texto da mensagem.
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message:
          'Este produto foi alterado por outra pessoa enquanto você editava. Recarregue para ver a versão atual.',
      });
    }
    return this.get(id);
  }

  async setStatus(id: string, status: ProductStatus): Promise<Product> {
    try {
      const row = await this.prisma.product.update({
        where: { id },
        // Mudou o estado: a versão sobe, invalidando formulários abertos com dados antigos.
        data: { status, version: { increment: 1 } },
        include: productInclude,
      });
      return toProduct(row);
    } catch (err) {
      if (isRecordNotFound(err)) throw new NotFoundException('Produto não encontrado');
      throw err;
    }
  }
}
