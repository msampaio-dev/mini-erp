import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Produção: uma linha JSON por evento (pesquisável em qualquer agregador de logs).
    // Desenvolvimento: texto colorido, legível no terminal.
    logger: new ConsoleLogger({ json: process.env['NODE_ENV'] === 'production', colors: process.env['NODE_ENV'] !== 'production' }),
  });
  configureApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
