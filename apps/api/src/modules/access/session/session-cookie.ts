import type { CookieOptions, Response } from 'express';

export const SESSION_COOKIE = 'erp_session';

/**
 * - httpOnly: JavaScript no navegador não lê o cookie (mitiga roubo via XSS).
 * - sameSite=lax: o navegador não envia o cookie em POST vindo de outro site (mitiga CSRF).
 * - secure: só trafega por HTTPS em produção (em dev, localhost é HTTP).
 */
function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(), expires: expiresAt });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, baseOptions());
}
