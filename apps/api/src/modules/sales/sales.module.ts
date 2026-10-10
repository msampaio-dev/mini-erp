import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';

@Module({
  // Vendas orquestra Catálogo (preços) e Estoque (baixas) pelas interfaces públicas deles.
  imports: [CatalogModule, InventoryModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
