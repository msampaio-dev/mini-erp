import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({
  // Depende do Catálogo e dos Fornecedores só pelas interfaces públicas deles.
  imports: [CatalogModule, SuppliersModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  // Vendas (Fase 5) vai baixar estoque por aqui, nunca escrevendo nas tabelas de estoque.
  exports: [InventoryService],
})
export class InventoryModule {}
