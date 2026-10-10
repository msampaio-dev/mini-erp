import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * Lado de LEITURA do sistema (CQRS simplificado, ADR 0012): só consulta, nunca escreve.
 * Lê várias tabelas com SQL agregado; é o único módulo com essa liberdade, porque
 * relatório é por natureza transversal e não altera estado de ninguém.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
