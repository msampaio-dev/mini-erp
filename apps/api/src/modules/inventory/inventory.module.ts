import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({
  // Depende do Catálogo só pela interface pública dele (ProductsService).
  imports: [CatalogModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  // Vendas (Fase 5) vai baixar estoque por aqui, nunca escrevendo nas tabelas de estoque.
  exports: [InventoryService],
})
export class InventoryModule {}
