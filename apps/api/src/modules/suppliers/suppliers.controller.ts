import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  supplierInputSchema,
  supplierListQuerySchema,
  type Page,
  type Supplier,
  type SupplierInput,
  type SupplierListQuery,
} from '@mini-erp/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../access/access-policy.js';
import { SuppliersService } from './suppliers.service.js';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('fornecedores:ler')
  list(@Query(new ZodValidationPipe(supplierListQuerySchema)) query: SupplierListQuery): Promise<Page<Supplier>> {
    return this.suppliers.list(query);
  }

  @Get(':id')
  @RequirePermission('fornecedores:ler')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Supplier> {
    return this.suppliers.get(id);
  }

  @Post()
  @RequirePermission('fornecedores:gerenciar')
  create(@Body(new ZodValidationPipe(supplierInputSchema)) input: SupplierInput): Promise<Supplier> {
    return this.suppliers.create(input);
  }

  @Put(':id')
  @RequirePermission('fornecedores:gerenciar')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(supplierInputSchema)) input: SupplierInput,
  ): Promise<Supplier> {
    return this.suppliers.update(id, input);
  }

  @Post(':id/deactivate')
  @RequirePermission('fornecedores:gerenciar')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<Supplier> {
    return this.suppliers.setActive(id, false);
  }

  @Post(':id/activate')
  @RequirePermission('fornecedores:gerenciar')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<Supplier> {
    return this.suppliers.setActive(id, true);
  }
}
