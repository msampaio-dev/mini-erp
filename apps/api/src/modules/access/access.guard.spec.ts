import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@mini-erp/contracts';
import { AccessGuard } from './access.guard.js';
import type { AccessPolicy } from './access-policy.js';
import type { SessionService, ValidatedSession } from './session/session.service.js';

function setup(opts: {
  policy?: AccessPolicy;
  cookie?: string;
  session?: ValidatedSession | null;
}) {
  const reflector = { getAllAndOverride: () => opts.policy } as unknown as Reflector;
  const validate = vi.fn(async () => opts.session ?? null);
  const sessions = { validate } as unknown as SessionService;
  const req: Record<string, unknown> = { cookies: opts.cookie ? { erp_session: opts.cookie } : {} };
  const res = { cookie: vi.fn(), clearCookie: vi.fn() };
  const ctx = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { guard: new AccessGuard(reflector, sessions), ctx, req, res, validate };
}

const sessionWith = (...permissions: Permission[]): ValidatedSession => ({
  auth: {
    sessionId: 's1',
    user: { id: 'u1', name: 'Ana', email: 'ana@x.com' },
    roles: [],
    permissions: new Set(permissions),
  },
});

describe('AccessGuard', () => {
  it('nega por padrão quando a rota não declara política (D10)', async () => {
    const { guard, ctx, validate } = setup({ session: sessionWith('usuarios:gerenciar') });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(validate).not.toHaveBeenCalled();
  });

  it('libera rota pública sem consultar sessão', async () => {
    const { guard, ctx, validate } = setup({ policy: { kind: 'public' } });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(validate).not.toHaveBeenCalled();
  });

  it('401 sem cookie de sessão', async () => {
    const { guard, ctx } = setup({ policy: { kind: 'authenticated' } });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 e limpa o cookie quando a sessão é inválida', async () => {
    const { guard, ctx, res } = setup({ policy: { kind: 'authenticated' }, cookie: 'tok', session: null });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('exige TODAS as permissões listadas', async () => {
    const policy: AccessPolicy = { kind: 'permissions', permissions: ['estoque:ler', 'estoque:ajustar'] };
    const { guard, ctx } = setup({ policy, cookie: 'tok', session: sessionWith('estoque:ler') });

    await expect(guard.canActivate(ctx)).rejects.toThrow('Permissão necessária: estoque:ajustar');
  });

  it('anexa o AuthContext à requisição e renova o cookie quando a sessão foi estendida', async () => {
    const renewedUntil = new Date(Date.now() + 3_600_000);
    const session = { ...sessionWith('estoque:ler'), renewedUntil };
    const policy: AccessPolicy = { kind: 'permissions', permissions: ['estoque:ler'] };
    const { guard, ctx, req, res } = setup({ policy, cookie: 'tok', session });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req['auth']).toBe(session.auth);
    expect(res.cookie).toHaveBeenCalledWith('erp_session', 'tok', expect.objectContaining({ expires: renewedUntil }));
  });
});
