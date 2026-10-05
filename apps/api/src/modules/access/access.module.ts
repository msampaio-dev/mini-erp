import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../../config/env.js';
import { AccessGuard } from './access.guard.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { SessionService } from './session/session.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

@Module({
  imports: [
    // Contador em memória: suficiente para uma instância. Com várias instâncias
    // atrás de um load balancer, troca-se o storage por Redis.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        { ttl: 60_000, limit: config.get('LOGIN_RATE_LIMIT', { infer: true }) },
      ],
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    SessionService,
    AuthService,
    UsersService,
    // Registrado como APP_GUARD: protege TODAS as rotas de TODOS os módulos.
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [SessionService],
})
export class AccessModule {}
