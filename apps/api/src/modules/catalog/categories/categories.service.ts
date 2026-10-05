import { ConflictException, Injectable } from '@nestjs/common';
import type { Category, CreateCategoryInput } from '@mini-erp/contracts';
import { uniqueViolationTarget } from '../../../common/prisma-errors.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

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
      if (uniqueViolationTarget(err) !== null) throw new ConflictException('Já existe uma categoria com este nome');
      throw err;
    }
  }
}
