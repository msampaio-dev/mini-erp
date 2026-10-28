import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createCategorySchema,
  updateCategorySchema,
  type Category,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@mini-erp/contracts';
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

  @Patch(':id')
  @RequirePermission('produtos:gerenciar')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) input: UpdateCategoryInput,
  ): Promise<Category> {
    return this.categories.rename(id, input);
  }

  @Delete(':id')
  @RequirePermission('produtos:gerenciar')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categories.remove(id);
  }
}
