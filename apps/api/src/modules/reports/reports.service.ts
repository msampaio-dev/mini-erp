import { Injectable } from '@nestjs/common';
import type {
  AbcRow,
  InventoryValue,
  MarginRow,
  Period,
  ReorderRow,
  SalesReport,
  SalesReportQuery,
  SellerRow,
  StaleRow,
} from '@mini-erp/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import * as q from './reports.queries.js';

/**
 * Somas do Postgres chegam como bigint (BigInt no JS), NUMERIC como texto.
 * JSON.stringify não serializa BigInt: tudo vira `number` aqui. Os valores em centavos
 * cabem com folga em 2^53 (≈ R$ 90 trilhões).
 */
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Margem % sobre a receita, 2 casas; null quando não houve receita. */
const marginPct = (net: number, margin: number) => (net > 0 ? Math.round((margin / net) * 10_000) / 100 : null);

/** Curva ABC: A = itens que formam os primeiros 80% do faturamento; B = até 95%; C = o resto. */
const ABC_A = 0.8;
const ABC_B = 0.95;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private rows<T>(sql: Prisma.Sql) {
    return this.prisma.$queryRaw<T[]>(sql);
  }

  async sales(query: SalesReportQuery): Promise<SalesReport> {
    type Totals = {
      sales_count: number;
      canceled_count: number;
      gross: bigint;
      discount: bigint;
      returns: bigint;
      net: bigint;
      cost: bigint;
    };
    type Point = { bucket: string; sales_count: number; net: bigint; margin: bigint };

    const [[t], series] = await Promise.all([
      this.rows<Totals>(q.salesTotalsSql(query)),
      this.rows<Point>(q.salesSeriesSql(query, query.granularity)),
    ]);
    const salesCount = num(t!.sales_count);
    const net = num(t!.net);
    const margin = net - num(t!.cost);

    return {
      totals: {
        salesCount,
        canceledCount: num(t!.canceled_count),
        grossCents: num(t!.gross),
        discountCents: num(t!.discount),
        returnsCents: num(t!.returns),
        netCents: net,
        costCents: num(t!.cost),
        marginCents: margin,
        marginPct: marginPct(net, margin),
        avgTicketCents: salesCount > 0 ? Math.round(net / salesCount) : 0,
      },
      series: series.map((p) => ({
        bucket: p.bucket,
        salesCount: num(p.sales_count),
        netCents: num(p.net),
        marginCents: num(p.margin),
      })),
    };
  }

  async margin(period: Period, groupBy: 'product' | 'category'): Promise<MarginRow[]> {
    type Row = { id: string | null; sku: string | null; name: string; quantity: string; net: bigint; cost: bigint };
    const rows = await this.rows<Row>(q.marginSql(period, groupBy));
    return rows.map((r) => {
      const net = num(r.net);
      const margin = net - num(r.cost);
      return {
        id: r.id,
        sku: r.sku,
        name: r.name,
        quantity: num(r.quantity),
        netCents: net,
        costCents: num(r.cost),
        marginCents: margin,
        marginPct: marginPct(net, margin),
      };
    });
  }

  async abc(period: Period): Promise<AbcRow[]> {
    type Row = { product_id: string; sku: string; name: string; net: bigint; total: bigint; cumulative: bigint };
    const rows = await this.rows<Row>(q.abcSql(period));
    return rows.map((r) => {
      const net = num(r.net);
      const total = num(r.total);
      const cumulative = num(r.cumulative);
      // Classifica pelo acumulado ANTES do item: o produto que "cruza" os 80% ainda é A.
      const before = (cumulative - net) / total;
      return {
        productId: r.product_id,
        sku: r.sku,
        name: r.name,
        netCents: net,
        sharePct: Math.round((net / total) * 10_000) / 100,
        cumulativePct: Math.round((cumulative / total) * 10_000) / 100,
        abcClass: before < ABC_A ? 'A' : before < ABC_B ? 'B' : 'C',
      };
    });
  }

  async inventoryValue(): Promise<InventoryValue> {
    const [[v], reorder] = await Promise.all([
      this.rows<{ value: bigint; products_with_stock: number }>(q.inventoryValueSql()),
      this.reorder(),
    ]);
    return { valueCents: num(v!.value), productsWithStock: num(v!.products_with_stock), reorderCount: reorder.length };
  }

  async reorder(): Promise<ReorderRow[]> {
    type Row = { id: string; sku: string; name: string; unit: ReorderRow['unit']; quantity: string; min_stock: string; missing: string };
    const rows = await this.rows<Row>(q.reorderSql());
    return rows.map((r) => ({
      productId: r.id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      quantity: num(r.quantity),
      minStock: num(r.min_stock),
      missing: num(r.missing),
    }));
  }

  async stale(days: number): Promise<StaleRow[]> {
    type Row = { id: string; sku: string; name: string; unit: StaleRow['unit']; quantity: string; value: bigint; last_sale_at: Date | null };
    const rows = await this.rows<Row>(q.staleSql(days));
    return rows.map((r) => ({
      productId: r.id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      quantity: num(r.quantity),
      valueCents: num(r.value),
      lastSaleAt: r.last_sale_at?.toISOString() ?? null,
    }));
  }

  async sellers(period: Period): Promise<SellerRow[]> {
    type Row = { id: string; name: string; sales_count: number; canceled_count: number; net: bigint };
    const rows = await this.rows<Row>(q.sellersSql(period));
    return rows.map((r) => {
      const salesCount = num(r.sales_count);
      const net = num(r.net);
      return {
        userId: r.id,
        name: r.name,
        salesCount,
        canceledCount: num(r.canceled_count),
        netCents: net,
        avgTicketCents: salesCount > 0 ? Math.round(net / salesCount) : 0,
      };
    });
  }
}
