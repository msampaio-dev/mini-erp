import { Module } from '@nestjs/common';
import { CategoriesController } from './categories/categories.controller.js';
import { CategoriesService } from './categories/categories.service.js';
import { ProductsController } from './products/products.controller.js';
import { ProductsService } from './products/products.service.js';

@Module({
  controllers: [ProductsController, CategoriesController],
  providers: [ProductsService, CategoriesService],
  // Interface pública do Catálogo: o Estoque (Fase 4) usará o ProductsService,
  // nunca a tabela de produtos diretamente (ADR 0001).
  exports: [ProductsService],
})
export class CatalogModule {}
