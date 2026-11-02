import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  cancelSaleSchema,
  createReturnSchema,
  createSaleSchema,
  saleListQuerySchema,
  type CancelSaleInput,
  type CreateReturnInput,
  type CreateSaleInput,
  type Page,
  type Sale,
  type SaleListQuery,
  type SaleSummary,
} from '@mini-erp/contracts';
import { IdempotencyKey } from '../../common/idempotency-key.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentAuth, RequirePermission, type AuthContext } from '../access/access-policy.js';
import { SalesService } from './sales.service.js';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  @RequirePermission('vendas:criar')
  async create(
    @Body(new ZodValidationPipe(createSaleSchema)) input: CreateSaleInput,
    @IdempotencyKey() key: string,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Sale> {
    const result = await this.sales.create(input, auth.user.id, key);
    res.status(result.replayed ? 200 : 201);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.sale;
  }

  @Get()
  @RequirePermission('vendas:ler')
  list(@Query(new ZodValidationPipe(saleListQuerySchema)) query: SaleListQuery): Promise<Page<SaleSummary>> {
    return this.sales.list(query);
  }

  @Get(':id')
  @RequirePermission('vendas:ler')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Sale> {
    return this.sales.get(id);
  }

  @Post(':id/returns')
  @RequirePermission('vendas:devolver')
  async createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createReturnSchema)) input: CreateReturnInput,
    @IdempotencyKey() key: string,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Sale> {
    const result = await this.sales.createReturn(id, input, auth.user.id, key);
    res.status(result.replayed ? 200 : 201);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.sale;
  }

  @Post(':id/cancel')
  @RequirePermission('vendas:cancelar')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelSaleSchema)) input: CancelSaleInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Sale> {
    return this.sales.cancel(id, input, auth.user.id);
  }
}
