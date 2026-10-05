import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    HealthModule,
    AccessModule,
    CatalogModule,
    // Próximas fases: InventoryModule, SalesModule, ReportsModule
  ],
})
export class AppModule {}
