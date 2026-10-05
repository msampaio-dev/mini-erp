import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  createProductSchema,
  productListQuerySchema,
  updateProductSchema,
  type CreateProductInput,
  type Page,
  type Product,
  type ProductListQuery,
  type UpdateProductInput,
} from '@mini-erp/contracts';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../access/access-policy.js';
import { ProductsService } from './products.service.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission('produtos:ler')
  list(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery): Promise<Page<Product>> {
    return this.products.list(query);
  }

  @Get(':id')
  @RequirePermission('produtos:ler')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Product> {
    return this.products.get(id);
  }

  @Post()
  @RequirePermission('produtos:gerenciar')
  create(@Body(new ZodValidationPipe(createProductSchema)) input: CreateProductInput): Promise<Product> {
    return this.products.create(input);
  }

  // PUT = substituição completa, sempre acompanhada da versão (optimistic locking).
  @Put(':id')
  @RequirePermission('produtos:gerenciar')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) input: UpdateProductInput,
  ): Promise<Product> {
    return this.products.update(id, input);
  }

  @Post(':id/archive')
  @RequirePermission('produtos:gerenciar')
  @HttpCode(HttpStatus.OK)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<Product> {
    return this.products.setStatus(id, 'ARCHIVED');
  }

  @Post(':id/unarchive')
  @RequirePermission('produtos:gerenciar')
  @HttpCode(HttpStatus.OK)
  unarchive(@Param('id', ParseUUIDPipe) id: string): Promise<Product> {
    return this.products.setStatus(id, 'ACTIVE');
  }
}
