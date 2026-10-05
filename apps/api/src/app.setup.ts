import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Env } from './config/env.js';

/**
 * Configuração HTTP compartilhada entre main.ts e os testes e2e:
 * o teste exercita exatamente o mesmo pipeline que roda em produção.
 */
export function configureApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Todas as rotas sob /api: separa claramente a API dos assets do front em produção.
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  // Fecha conexões do banco com elegância em SIGTERM (deploys, docker stop).
  app.enableShutdownHooks();
}
