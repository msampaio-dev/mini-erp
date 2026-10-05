import {
  createParamDecorator,
  InternalServerErrorException,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '@mini-erp/contracts';
import type { AuthContext } from './auth-context.js';

/**
 * Toda rota precisa declarar UMA política de acesso. Sem política = 403 (D10).
 * Pode ser aplicada no controller (vale para todas as rotas) ou no método (sobrescreve).
 */
export type AccessPolicy =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'permissions'; permissions: readonly Permission[] };

export const ACCESS_POLICY = 'access:policy';

/** Rota aberta, sem login (ex.: health check, login). */
export const Public = () => SetMetadata(ACCESS_POLICY, { kind: 'public' } satisfies AccessPolicy);

/** Basta estar logado (ex.: /auth/me, logout). */
export const Authenticated = () =>
  SetMetadata(ACCESS_POLICY, { kind: 'authenticated' } satisfies AccessPolicy);

/** Exige TODAS as permissões listadas. */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(ACCESS_POLICY, { kind: 'permissions', permissions } satisfies AccessPolicy);

/** Injeta o AuthContext da requisição: `me(@CurrentAuth() auth: AuthContext)`. */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<Request>().auth;
  // Só acontece se alguém usar @CurrentAuth numa rota @Public: erro de programação.
  if (!auth) throw new InternalServerErrorException('CurrentAuth usado em rota sem autenticação');
  return auth;
});

export type { AuthContext };
