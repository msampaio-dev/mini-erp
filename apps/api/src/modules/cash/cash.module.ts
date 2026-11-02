import { Module } from '@nestjs/common';
import { CashController } from './cash.controller.js';
import { CashService } from './cash.service.js';

@Module({
  controllers: [CashController],
  providers: [CashService],
  // Vendas usa a interface pública (sessão aberta, dinheiro que entra e sai), nunca as tabelas.
  exports: [CashService],
})
export class CashModule {}
