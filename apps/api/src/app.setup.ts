import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { requestLogging } from './common/request-logging.js';
import type { Env } from './config/env.js';

/**
 * Configuração HTTP compartilhada entre main.ts e os testes e2e:
 * o teste exercita exatamente o mesmo pipeline que roda em produção.
 */
export function configureApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Atrás do Caddy, o IP real do cliente vem no X-Forwarded-For (ADR 0013).
  (app as NestExpressApplication).set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  // Cabeçalhos de segurança (nosniff, HSTS, frame-ancestors etc.). A CSP da página
  // é definida no Caddy, que serve o HTML; aqui as respostas são JSON.
  app.use(helmet());
  app.use(requestLogging);
  app.useGlobalFilters(new AllExceptionsFilter());

  // Todas as rotas sob /api: separa claramente a API dos assets do front em produção.
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  // Fecha conexões do banco com elegância em SIGTERM (deploys, docker stop).
  app.enableShutdownHooks();
}
