import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Category, CreateCategoryInput, UpdateCategoryInput } from '@mini-erp/contracts';
import { isForeignKeyViolation, isRecordNotFound, uniqueViolationTarget } from '../../../common/prisma-errors.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

const DUPLICATE = 'Já existe uma categoria com este nome';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Category[]> {
    return this.prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  async create(input: CreateCategoryInput): Promise<Category> {
    try {
      return await this.prisma.category.create({ data: input, select: { id: true, name: true } });
    } catch (err) {
      if (uniqueViolationTarget(err) !== null) throw new ConflictException(DUPLICATE);
      throw err;
    }
  }

  async rename(id: string, input: UpdateCategoryInput): Promise<Category> {
    try {
      return await this.prisma.category.update({ where: { id }, data: input, select: { id: true, name: true } });
    } catch (err) {
      if (uniqueViolationTarget(err) !== null) throw new ConflictException(DUPLICATE);
      if (isRecordNotFound(err)) throw new NotFoundException('Categoria não encontrada');
      throw err;
    }
  }

  /**
   * Excluir só se nenhum produto usa a categoria. Quem garante é a chave estrangeira
   * (ON DELETE RESTRICT): tentamos apagar e traduzimos a recusa do banco, em vez de
   * "contar produtos e depois apagar" (um produto criado entre os dois passos escaparia).
   */
  async remove(id: string): Promise<void> {
    try {
      await this.prisma.category.delete({ where: { id } });
    } catch (err) {
      if (isRecordNotFound(err)) throw new NotFoundException('Categoria não encontrada');
      if (isForeignKeyViolation(err)) {
        const inUse = await this.prisma.product.count({ where: { categoryId: id } });
        throw new ConflictException({
          code: 'CATEGORY_IN_USE',
          message: `Categoria em uso por ${inUse} produto(s). Mova-os para outra categoria antes de excluir.`,
        });
      }
      throw err;
    }
  }
}
