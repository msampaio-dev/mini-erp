import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { SalesModule } from './modules/sales/sales.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    HealthModule,
    AccessModule,
    CatalogModule,
    InventoryModule,
    SalesModule,
    // Próxima fase: ReportsModule
  ],
})
export class AppModule {}
