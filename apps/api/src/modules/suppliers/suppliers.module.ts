import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService],
  // O Estoque confere o fornecedor da entrada pela interface pública, não pela tabela (ADR 0001).
  exports: [SuppliersService],
})
export class SuppliersModule {}
