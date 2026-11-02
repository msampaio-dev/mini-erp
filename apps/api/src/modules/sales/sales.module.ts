import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';

@Module({
  // Vendas orquestra Catálogo (preços), Estoque (baixas) e Caixa (gaveta) pelas interfaces públicas deles.
  imports: [CatalogModule, InventoryModule, CashModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
