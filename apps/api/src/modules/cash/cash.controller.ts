import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  cashMovementInputSchema,
  cashSessionListQuerySchema,
  closeCashSchema,
  openCashSchema,
  type CashMovement,
  type CashMovementInput,
  type CashSession,
  type CashSessionListQuery,
  type CashSessionSummary,
  type CloseCashInput,
  type OpenCashInput,
  type Page,
} from '@mini-erp/contracts';
import { IdempotencyKey } from '../../common/idempotency-key.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentAuth, RequirePermission, type AuthContext } from '../access/access-policy.js';
import { CashService } from './cash.service.js';

@Controller('cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  /** O caixa aberto de quem chama. Envelope { session }: um `null` puro viraria corpo vazio no HTTP. */
  @Get('current')
  @RequirePermission('caixa:operar')
  async current(@CurrentAuth() auth: AuthContext): Promise<{ session: CashSession | null }> {
    return { session: await this.cash.current(auth) };
  }

  @Post('open')
  @RequirePermission('caixa:operar')
  open(
    @Body(new ZodValidationPipe(openCashSchema)) input: OpenCashInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CashSession> {
    return this.cash.open(input, auth);
  }

  @Post('current/movements')
  @RequirePermission('caixa:operar')
  addMovement(
    @Body(new ZodValidationPipe(cashMovementInputSchema))
    input: CashMovementInput,
    @IdempotencyKey() key: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CashMovement> {
    return this.cash.addMovement(input, auth, key);
  }

  @Post('current/close')
  @RequirePermission('caixa:operar')
  @HttpCode(HttpStatus.OK)
  closeCurrent(
    @Body(new ZodValidationPipe(closeCashSchema)) input: CloseCashInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CashSession> {
    return this.cash.close(null, input, auth);
  }

  @Get('sessions')
  @RequirePermission('caixa:gerenciar')
  list(
    @Query(new ZodValidationPipe(cashSessionListQuerySchema))
    query: CashSessionListQuery,
  ): Promise<Page<CashSessionSummary>> {
    return this.cash.list(query);
  }

  /** O operador vê o próprio caixa; o gerente, qualquer um (a regra fica no serviço). */
  @Get('sessions/:id')
  @RequirePermission('caixa:operar')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext): Promise<CashSession> {
    return this.cash.get(id, auth);
  }

  /** Gerente fecha o caixa de quem esqueceu aberto. */
  @Post('sessions/:id/close')
  @RequirePermission('caixa:gerenciar')
  @HttpCode(HttpStatus.OK)
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(closeCashSchema)) input: CloseCashInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CashSession> {
    return this.cash.close(id, input, auth);
  }
}
