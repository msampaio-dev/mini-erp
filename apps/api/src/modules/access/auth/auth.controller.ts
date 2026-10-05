import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { loginSchema, type LoginInput, type Me } from '@mini-erp/contracts';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { Authenticated, CurrentAuth, Public, type AuthContext } from '../access-policy.js';
import { toMe } from '../auth-context.js';
import { SessionService } from '../session/session.service.js';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '../session/session-cookie.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @Public()
  @UseGuards(ThrottlerGuard) // limita tentativas por IP: freio contra força bruta
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    // Se já havia uma sessão neste navegador, ela é encerrada: sempre um token novo por login.
    const previous: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof previous === 'string' && previous) await this.sessions.revokeToken(previous);

    const { token, expiresAt } = await this.auth.login(input, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    setSessionCookie(res, token, expiresAt);

    const session = await this.sessions.validate(token);
    return toMe(session!.auth);
  }

  @Post('logout')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(auth.sessionId);
    clearSessionCookie(res);
  }

  @Get('me')
  @Authenticated()
  me(@CurrentAuth() auth: AuthContext): Me {
    return toMe(auth);
  }
}
