import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { join } from 'node:path';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { requestLogging } from './common/request-logging.js';
import type { Env } from './config/env.js';

/**
 * Configuração HTTP compartilhada entre main.ts e os testes e2e:
 * o teste exercita exatamente o mesmo pipeline que roda em produção.
 */
export function configureApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const express = app as NestExpressApplication;

  // Atrás de um proxy (Caddy, Render), o IP real do cliente vem no X-Forwarded-For.
  express.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  // Cabeçalhos de segurança. A CSP é a mesma do Caddy (ADR 0013): vale quando a própria
  // API serve o front (modo Render, ADR 0015); atrás do Caddy, a do Caddy prevalece.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );
  app.use(requestLogging);
  app.useGlobalFilters(new AllExceptionsFilter());

  const webDist = config.get('WEB_DIST_DIR', { infer: true });
  if (webDist) serveWebApp(express, webDist);

  // Todas as rotas sob /api: separa claramente a API dos assets do front em produção.
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  // Fecha conexões do banco com elegância em SIGTERM (deploys, docker stop).
  app.enableShutdownHooks();
}

/**
 * Modo "um serviço só" (ADR 0015): a API também entrega o React, na MESMA origem.
 * Faz o papel que o Caddy faz na stack Docker: assets com cache imutável, index.html
 * sempre revalidado e fallback de SPA (qualquer rota que não seja /api devolve o index.html).
 */
function serveWebApp(app: NestExpressApplication, dir: string) {
  const index = join(dir, 'index.html');
  app.useStaticAssets(dir, {
    index: false,
    setHeaders: (res, path) => {
      const immutable = /[\\/]assets[\\/]/.test(path);
      res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
