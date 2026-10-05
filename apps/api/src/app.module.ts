import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AccessModule } from './modules/access/access.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    HealthModule,
    AccessModule,
    // Próximas fases: CatalogModule, InventoryModule, SalesModule, ReportsModule
  ],
})
export class AppModule {}
