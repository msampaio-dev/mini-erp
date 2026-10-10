import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  exportQuerySchema,
  marginReportQuerySchema,
  periodExportQuerySchema,
  salesReportQuerySchema,
  staleQuerySchema,
  type AbcRow,
  type ExportQuery,
  type InventoryValue,
  type MarginReportQuery,
  type MarginRow,
  type PeriodExportQuery,
  type ReorderRow,
  type SalesReport,
  type SalesReportQuery,
  type SellerRow,
  type StaleQuery,
  type StaleRow,
} from '@mini-erp/contracts';
import { centsCell, toCsv, type CsvColumn } from '../../common/csv.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../access/access-policy.js';
import { ReportsService } from './reports.service.js';

/** JSON por padrão; com ?format=csv devolve o arquivo para o Excel. */
function respond<T>(res: Response, format: 'json' | 'csv', filename: string, columns: CsvColumn<T>[], rows: T[]) {
  if (format === 'json') return rows;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  return toCsv(columns, rows);
}

const pctCell = (v: number | null) => (v === null ? '' : v);
const periodName = (base: string, q: { from: string; to: string }) => `${base}_${q.from}_a_${q.to}`;

@Controller('reports')
@RequirePermission('relatorios:ler') // vale para todos os relatórios
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  sales(@Query(new ZodValidationPipe(salesReportQuerySchema)) query: SalesReportQuery): Promise<SalesReport> {
    return this.reports.sales(query);
  }

  @Get('margin')
  async margin(
    @Query(new ZodValidationPipe(marginReportQuerySchema)) query: MarginReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MarginRow[] | string> {
    const rows = await this.reports.margin(query, query.groupBy);
    return respond(res, query.format, periodName(`margem_por_${query.groupBy === 'product' ? 'produto' : 'categoria'}`, query), [
      ...(query.groupBy === 'product' ? [{ header: 'SKU', value: (r: MarginRow) => r.sku }] : []),
      { header: query.groupBy === 'product' ? 'Produto' : 'Categoria', value: (r) => r.name },
      { header: 'Quantidade', value: (r) => r.quantity },
      { header: 'Receita líquida (R$)', value: (r) => centsCell(r.netCents) },
      { header: 'Custo (R$)', value: (r) => centsCell(r.costCents) },
      { header: 'Margem (R$)', value: (r) => centsCell(r.marginCents) },
      { header: 'Margem (%)', value: (r) => pctCell(r.marginPct) },
    ], rows);
  }

  @Get('abc')
  async abc(
    @Query(new ZodValidationPipe(periodExportQuerySchema)) query: PeriodExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AbcRow[] | string> {
    const rows = await this.reports.abc(query);
    return respond(res, query.format, periodName('curva_abc', query), [
      { header: 'Classe', value: (r: AbcRow) => r.abcClass },
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Produto', value: (r) => r.name },
      { header: 'Receita líquida (R$)', value: (r) => centsCell(r.netCents) },
      { header: 'Participação (%)', value: (r) => r.sharePct },
      { header: 'Acumulado (%)', value: (r) => r.cumulativePct },
    ], rows);
  }

  @Get('sellers')
  async sellers(
    @Query(new ZodValidationPipe(periodExportQuerySchema)) query: PeriodExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SellerRow[] | string> {
    const rows = await this.reports.sellers(query);
    return respond(res, query.format, periodName('vendedores', query), [
      { header: 'Vendedor', value: (r: SellerRow) => r.name },
      { header: 'Vendas', value: (r) => r.salesCount },
      { header: 'Canceladas', value: (r) => r.canceledCount },
      { header: 'Receita líquida (R$)', value: (r) => centsCell(r.netCents) },
      { header: 'Ticket médio (R$)', value: (r) => centsCell(r.avgTicketCents) },
    ], rows);
  }

  @Get('inventory')
  inventory(): Promise<InventoryValue> {
    return this.reports.inventoryValue();
  }

  @Get('reorder')
  async reorder(
    @Query(new ZodValidationPipe(exportQuerySchema)) query: ExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReorderRow[] | string> {
    const rows = await this.reports.reorder();
    return respond(res, query.format, 'reposicao', [
      { header: 'SKU', value: (r: ReorderRow) => r.sku },
      { header: 'Produto', value: (r) => r.name },
      { header: 'Unidade', value: (r) => r.unit },
      { header: 'Saldo', value: (r) => r.quantity },
      { header: 'Mínimo', value: (r) => r.minStock },
      { header: 'Faltam', value: (r) => r.missing },
    ], rows);
  }

  @Get('stale')
  async stale(
    @Query(new ZodValidationPipe(staleQuerySchema)) query: StaleQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaleRow[] | string> {
    const rows = await this.reports.stale(query.days);
    return respond(res, query.format, `parados_${query.days}_dias`, [
      { header: 'SKU', value: (r: StaleRow) => r.sku },
      { header: 'Produto', value: (r) => r.name },
      { header: 'Saldo', value: (r) => r.quantity },
      { header: 'Unidade', value: (r) => r.unit },
      { header: 'Valor parado (R$)', value: (r) => centsCell(r.valueCents) },
      { header: 'Última venda', value: (r) => r.lastSaleAt?.slice(0, 10) ?? 'nunca' },
    ], rows);
  }
}
