import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  balancesQuerySchema,
  createAdjustmentSchema,
  createEntrySchema,
  movementListQuerySchema,
  reverseMovementSchema,
  type Balance,
  type BalancesQuery,
  type CreateAdjustmentInput,
  type CreateEntryInput,
  type Movement,
  type MovementListQuery,
  type Page,
  type ReverseMovementInput,
} from '@mini-erp/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentAuth, RequirePermission, type AuthContext } from '../access/access-policy.js';
import { IdempotencyKey } from '../../common/idempotency-key.decorator.js';
import { InventoryService, type MovementResult } from './inventory.service.js';

/** 201 na primeira vez; 200 + cabeçalho Idempotent-Replayed quando é repetição. */
function respond(res: Response, result: MovementResult): Movement {
  res.status(result.replayed ? 200 : 201);
  if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return result.movement;
}

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('entries')
  @RequirePermission('estoque:entrada')
  async entry(
    @Body(new ZodValidationPipe(createEntrySchema)) input: CreateEntryInput,
    @IdempotencyKey() key: string,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Movement> {
    return respond(res, await this.inventory.registerEntry(input, auth.user.id, key));
  }

  @Post('adjustments')
  @RequirePermission('estoque:ajustar')
  async adjustment(
    @Body(new ZodValidationPipe(createAdjustmentSchema)) input: CreateAdjustmentInput,
    @IdempotencyKey() key: string,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Movement> {
    return respond(res, await this.inventory.registerAdjustment(input, auth.user.id, key));
  }

  @Post('movements/:id/reverse')
  @RequirePermission('estoque:ajustar')
  async reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reverseMovementSchema)) input: ReverseMovementInput,
    @IdempotencyKey() key: string,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Movement> {
    return respond(res, await this.inventory.reverse(id, input, auth.user.id, key));
  }

  @Get('movements')
  @RequirePermission('estoque:ler')
  movements(@Query(new ZodValidationPipe(movementListQuerySchema)) query: MovementListQuery): Promise<Page<Movement>> {
    return this.inventory.listMovements(query);
  }

  @Get('balances')
  @RequirePermission('estoque:ler')
  balances(@Query(new ZodValidationPipe(balancesQuerySchema)) query: BalancesQuery): Promise<Balance[]> {
    return this.inventory.getBalances(query.productIds);
  }
}
