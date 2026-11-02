import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Page, Supplier, SupplierInput, SupplierListQuery } from '@mini-erp/contracts';
import { uniqueViolationTarget } from '../../common/prisma-errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

type SupplierRow = Prisma.SupplierGetPayload<object>;

const toSupplier = (row: SupplierRow): Supplier => ({
  id: row.id,
  name: row.name,
  document: row.document,
  phone: row.phone,
  email: row.email,
  note: row.note,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
});

function mapWriteError(err: unknown): never {
  if (uniqueViolationTarget(err)?.includes('document')) {
    throw new ConflictException('Já existe um fornecedor com este CNPJ/CPF');
  }
  throw err;
}

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: SupplierListQuery): Promise<Page<Supplier>> {
    const digits = query.q?.replace(/\D/g, '');
    const where: Prisma.SupplierWhereInput = {
      ...(query.active !== 'all' && { active: query.active === 'true' }),
      // Nome por trecho (índice trigram); documento pelo começo dos dígitos.
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          ...(digits ? [{ document: { startsWith: digits } }] : []),
        ],
      }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toSupplier), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string): Promise<Supplier> {
    const row = await this.prisma.supplier.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Fornecedor não encontrado');
    return toSupplier(row);
  }

  async create(input: SupplierInput): Promise<Supplier> {
    try {
      return toSupplier(await this.prisma.supplier.create({ data: input }));
    } catch (err) {
      mapWriteError(err);
    }
  }

  async update(id: string, input: SupplierInput): Promise<Supplier> {
    await this.get(id);
    try {
      return toSupplier(await this.prisma.supplier.update({ where: { id }, data: input }));
    } catch (err) {
      mapWriteError(err);
    }
  }

  /** Desativar, nunca apagar: as entradas antigas continuam mostrando de quem a mercadoria veio. */
  async setActive(id: string, active: boolean): Promise<Supplier> {
    await this.get(id);
    return toSupplier(await this.prisma.supplier.update({ where: { id }, data: { active } }));
  }

  /** Interface para o Estoque: fornecedor da entrada precisa existir e estar ativo. */
  async assertActive(id: string): Promise<void> {
    const row = await this.prisma.supplier.findUnique({ where: { id }, select: { active: true } });
    if (!row) throw new NotFoundException('Fornecedor não encontrado');
    if (!row.active) throw new ConflictException({ code: 'SUPPLIER_INACTIVE', message: 'Fornecedor desativado' });
  }
}
