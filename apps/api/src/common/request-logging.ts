import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

declare module 'express-serve-static-core' {
  interface Request {
    /** ID de correlação: aparece no log, no cabeçalho X-Request-Id e na resposta de erro 500. */
    id?: string;
  }
}

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Aceita o ID vindo de um proxy/cliente só se tiver formato seguro: evita injeção no log.
const SAFE_ID = /^[\w-]{8,64}$/;

const logger = new Logger('HTTP');

/**
 * Atribui um ID a cada requisição e registra UMA linha ao final, com método, rota,
 * status, duração e usuário. Com logs em JSON (produção), cada linha é um objeto
 * pesquisável: "todas as requisições do usuário X com status 500 na última hora".
 */
export function requestLogging(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get(REQUEST_ID_HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    // Health check é chamado a cada poucos segundos pelo orquestrador: só poluiria o log.
    if (req.path.startsWith('/api/health')) return;
    const entry = {
      requestId: req.id,
      method: req.method,
      path: req.path, // sem query string: não arrisca registrar dados sensíveis por acidente
      status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - start) / 1_000_000n),
      userId: req.auth?.user.id,
    };
    if (res.statusCode >= 500) logger.error(entry);
    else if (res.statusCode >= 400) logger.warn(entry);
    else logger.log(entry);
  });
  next();
}
