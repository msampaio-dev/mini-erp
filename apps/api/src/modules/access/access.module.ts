import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../../config/env.js';
import { AccessGuard } from './access.guard.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AccessMaintenanceService } from './maintenance/access-maintenance.service.js';
import { PrismaThrottlerStorage } from './rate-limit/prisma-throttler.storage.js';
import { SessionService } from './session/session.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

@Module({
  imports: [
    // Contadores no Postgres (ADR 0014): funciona igual com 1 ou N instâncias da API,
    // sem precisar de Redis. PrismaService vem do PrismaModule (global).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService<Env, true>, prisma: PrismaService) => ({
        throttlers: [{ ttl: 60_000, limit: config.get('LOGIN_RATE_LIMIT', { infer: true }) }],
        storage: new PrismaThrottlerStorage(prisma),
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    SessionService,
    AuthService,
    UsersService,
    AccessMaintenanceService,
    // Registrado como APP_GUARD: protege TODAS as rotas de TODOS os módulos.
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [SessionService],
})
export class AccessModule {}
