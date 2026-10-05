import { Body, Controller, Get, Post } from '@nestjs/common';
import { createCategorySchema, type Category, type CreateCategoryInput } from '@mini-erp/contracts';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../access/access-policy.js';
import { CategoriesService } from './categories.service.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission('produtos:ler')
  list(): Promise<Category[]> {
    return this.categories.list();
  }

  @Post()
  @RequirePermission('produtos:gerenciar')
  create(@Body(new ZodValidationPipe(createCategorySchema)) input: CreateCategoryInput): Promise<Category> {
    return this.categories.create(input);
  }
}
