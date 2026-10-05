import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ACCESS_POLICY, type AccessPolicy } from './access-policy.js';
import { SessionService } from './session/session.service.js';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './session/session-cookie.js';

/**
 * Guard global: roda antes de TODA rota da API.
 * 1. Lê a política da rota; sem política -> 403 (negar por padrão).
 * 2. Rotas públicas passam direto.
 * 3. Demais exigem sessão válida (401) e, se for o caso, permissões (403).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS_POLICY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!policy) {
      // Esquecer de proteger uma rota vira um 403 + log de erro, não uma brecha.
      this.logger.error(`Rota sem política de acesso: ${ctx.getClass().name}.${ctx.getHandler().name}`);
      throw new ForbiddenException('Acesso negado');
    }

    if (policy.kind === 'public') return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];

    if (typeof token !== 'string' || token === '') {
      throw new UnauthorizedException('Sessão ausente');
    }

    const session = await this.sessions.validate(token);
    if (!session) {
      clearSessionCookie(res);
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }

    req.auth = session.auth;
    if (session.renewedUntil) setSessionCookie(res, token, session.renewedUntil);

    if (policy.kind === 'authenticated') return true;

    const missing = policy.permissions.filter((p) => !session.auth.permissions.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Permissão necessária: ${missing.join(', ')}`);
    }
    return true;
  }
}
