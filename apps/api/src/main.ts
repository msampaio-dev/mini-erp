import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Todas as rotas sob /api: separa claramente a API dos assets do front em produção.
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  // Fecha conexões do banco com elegância em SIGTERM (deploys, docker stop).
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
