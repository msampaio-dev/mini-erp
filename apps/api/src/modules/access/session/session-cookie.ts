import type { CookieOptions, Response } from 'express';

const isProduction = process.env['NODE_ENV'] === 'production';

/**
 * Em produção o cookie usa o prefixo `__Host-`: o navegador SÓ o aceita se for Secure,
 * Path=/ e sem Domain. Isso impede que um subdomínio (ex.: um blog em blog.empresa.com)
 * injete ou sobrescreva o cookie de sessão do ERP. Em dev (HTTP) o prefixo não é permitido.
 */
export const SESSION_COOKIE = isProduction ? '__Host-erp_session' : 'erp_session';

/**
 * - httpOnly: JavaScript no navegador não lê o cookie (mitiga roubo via XSS).
 * - sameSite=lax: o navegador não envia o cookie em POST vindo de outro site (mitiga CSRF).
 * - secure: só trafega por HTTPS em produção (em dev, localhost é HTTP).
 */
function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(), expires: expiresAt });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, baseOptions());
}
