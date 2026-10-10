import { REPORT_TIMEZONE, type Granularity, type Period } from '@mini-erp/contracts';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * Consultas dos relatórios (ADR 0012). Cada função MONTA um Prisma.Sql parametrizado,
 * sem executar: o mesmo objeto é usado pelo serviço e pelo script de medição com
 * EXPLAIN ANALYZE (scripts/perf). Valores sempre como parâmetros, nunca concatenados.
 *
 * Período: datas inclusivas viram o intervalo semiaberto [início, fim) em São Paulo:
 *   lo = '2026-10-01 00:00' em SP  ->  created_at >= lo
 *   hi = '2026-10-11 00:00' em SP  ->  created_at <  hi
 * `timestamp AT TIME ZONE 'zona'` interpreta o horário local naquela zona e devolve timestamptz.
 */
const tz = REPORT_TIMEZONE;

const bounds = (p: Period) => Prisma.sql`
  bounds AS (
    SELECT (${p.from}::date)::timestamp AT TIME ZONE ${tz} AS lo,
           ((${p.to}::date) + 1)::timestamp AT TIME ZONE ${tz} AS hi
  )`;

/** Itens com a venda e os limites do período (o filtro de status fica em cada consulta). */
const itemsWithSale = Prisma.sql`
  sale_items i
  JOIN sales s ON s.id = i.sale_id
  CROSS JOIN bounds b`;

const inPeriod = Prisma.sql`s.created_at >= b.lo AND s.created_at < b.hi`;

/** Totais do período. FILTER faz várias contagens/somas numa única passada pela tabela. */
export const salesTotalsSql = (p: Period) => Prisma.sql`
  WITH ${bounds(p)},
  head AS (
    SELECT
      count(*) FILTER (WHERE s.status = 'COMPLETED')::int                         AS sales_count,
      count(*) FILTER (WHERE s.status = 'CANCELED')::int                          AS canceled_count,
      coalesce(sum(s.subtotal_cents) FILTER (WHERE s.status = 'COMPLETED'), 0)::bigint AS gross,
      coalesce(sum(s.discount_cents) FILTER (WHERE s.status = 'COMPLETED'), 0)::bigint AS discount,
      coalesce(sum(s.total_cents)    FILTER (WHERE s.status = 'COMPLETED'), 0)::bigint AS net
    FROM sales s CROSS JOIN bounds b
    WHERE ${inPeriod}
  ),
  cost AS (
    -- Custo da mercadoria vendida: quantidade × custo médio FOTOGRAFADO na venda (ADR 0011).
    SELECT coalesce(round(sum(i.quantity * i.unit_cost_cents)), 0)::bigint AS cost
    FROM ${itemsWithSale}
    WHERE s.status = 'COMPLETED' AND ${inPeriod}
  )
  SELECT head.*, cost.cost FROM head, cost`;

/**
 * Série temporal. generate_series cria TODOS os dias/semanas/meses do período, e o LEFT JOIN
 * preenche com zero os que não tiveram venda: o gráfico não "pula" dias.
 * O dia de cada venda é calculado no fuso de São Paulo (D32).
 */
export const salesSeriesSql = (p: Period, granularity: Granularity) => Prisma.sql`
  WITH ${bounds(p)},
  buckets AS (
    SELECT generate_series(
      date_trunc(${granularity}, ${p.from}::date::timestamp),
      ${p.to}::date::timestamp,
      ('1 ' || ${granularity})::interval
    )::date AS bucket
  ),
  sold AS (
    SELECT date_trunc(${granularity}, s.created_at AT TIME ZONE ${tz})::date AS bucket,
           count(*)::int AS sales_count,
           sum(s.total_cents)::bigint AS net
    FROM sales s CROSS JOIN bounds b
    WHERE s.status = 'COMPLETED' AND ${inPeriod}
    GROUP BY 1
  ),
  cost AS (
    SELECT date_trunc(${granularity}, s.created_at AT TIME ZONE ${tz})::date AS bucket,
           round(sum(i.quantity * i.unit_cost_cents))::bigint AS cost
    FROM ${itemsWithSale}
    WHERE s.status = 'COMPLETED' AND ${inPeriod}
    GROUP BY 1
  )
  SELECT to_char(bk.bucket, 'YYYY-MM-DD') AS bucket,
         coalesce(sold.sales_count, 0)                         AS sales_count,
         coalesce(sold.net, 0)::bigint                         AS net,
         (coalesce(sold.net, 0) - coalesce(cost.cost, 0))::bigint AS margin
  FROM buckets bk
  LEFT JOIN sold USING (bucket)
  LEFT JOIN cost USING (bucket)
  ORDER BY bk.bucket`;

/** Margem por produto ou por categoria (receita líquida - custo fotografado). */
export const marginSql = (p: Period, groupBy: 'product' | 'category') => {
  const key =
    groupBy === 'product'
      ? Prisma.sql`p.id AS id, p.sku AS sku, p.name AS name`
      : Prisma.sql`c.id AS id, NULL::text AS sku, coalesce(c.name::text, 'Sem categoria') AS name`;
  const group = groupBy === 'product' ? Prisma.sql`p.id, p.sku, p.name` : Prisma.sql`c.id, c.name`;
  return Prisma.sql`
    WITH ${bounds(p)}
    SELECT ${key},
           sum(i.quantity)::text                              AS quantity,
           sum(i.net_cents)::bigint                           AS net,
           round(sum(i.quantity * i.unit_cost_cents))::bigint AS cost
    FROM ${itemsWithSale}
    JOIN products p ON p.id = i.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE s.status = 'COMPLETED' AND ${inPeriod}
    GROUP BY ${group}
    ORDER BY (sum(i.net_cents) - round(sum(i.quantity * i.unit_cost_cents))) DESC, 3`;
};

/**
 * Curva ABC por faturamento. A window function `sum(...) OVER (ORDER BY ...)` calcula o
 * acumulado linha a linha sem subconsulta; `sum(...) OVER ()` dá o total geral.
 */
export const abcSql = (p: Period) => Prisma.sql`
  WITH ${bounds(p)},
  per_product AS (
    SELECT i.product_id, sum(i.net_cents)::bigint AS net
    FROM ${itemsWithSale}
    WHERE s.status = 'COMPLETED' AND ${inPeriod}
    GROUP BY i.product_id
    HAVING sum(i.net_cents) > 0
  ),
  ranked AS (
    SELECT product_id, net,
           sum(net) OVER () AS total,
           sum(net) OVER (ORDER BY net DESC, product_id ROWS UNBOUNDED PRECEDING) AS cumulative
    FROM per_product
  )
  SELECT r.product_id, p.sku, p.name, r.net::bigint, r.total::bigint, r.cumulative::bigint
  FROM ranked r JOIN products p ON p.id = r.product_id
  ORDER BY r.net DESC, r.product_id`;

/** Valor do estoque a custo médio. */
export const inventoryValueSql = () => Prisma.sql`
  SELECT coalesce(round(sum(b.quantity * b.avg_cost_cents)), 0)::bigint AS value,
         count(*) FILTER (WHERE b.quantity > 0)::int                   AS products_with_stock
  FROM stock_balances b`;

/** Lista de reposição: ativos abaixo do mínimo, mais críticos primeiro. */
export const reorderSql = () => Prisma.sql`
  SELECT p.id, p.sku, p.name, p.unit::text AS unit,
         coalesce(b.quantity, 0)::text                AS quantity,
         p.min_stock::text                            AS min_stock,
         (p.min_stock - coalesce(b.quantity, 0))::text AS missing
  FROM products p
  LEFT JOIN stock_balances b ON b.product_id = p.id
  WHERE p.status = 'ACTIVE' AND p.min_stock > 0 AND coalesce(b.quantity, 0) < p.min_stock
  ORDER BY coalesce(b.quantity, 0) / p.min_stock, p.name`;

/**
 * Produtos parados: com saldo e sem venda há `days` dias (ou nunca vendidos).
 *
 * A última venda de TODOS os produtos sai de uma única passada agregada (GROUP BY).
 * A 1ª versão usava LEFT JOIN LATERAL ("para cada produto, busque a última venda"):
 * com 50 mil vendas o planejador fazia uma varredura de `sales` POR produto, e a consulta
 * levava ~2,6 s. Agregar uma vez e cruzar depois resolveu sem índice novo (ADR 0012, D35).
 */
export const staleSql = (days: number) => Prisma.sql`
  WITH last_sale AS (
    SELECT i.product_id, max(s.created_at) AS at
    FROM sale_items i JOIN sales s ON s.id = i.sale_id
    WHERE s.status = 'COMPLETED'
    GROUP BY i.product_id
  )
  SELECT p.id, p.sku, p.name, p.unit::text AS unit,
         b.quantity::text                              AS quantity,
         round(b.quantity * b.avg_cost_cents)::bigint  AS value,
         last_sale.at                                  AS last_sale_at
  FROM products p
  JOIN stock_balances b ON b.product_id = p.id AND b.quantity > 0
  LEFT JOIN last_sale ON last_sale.product_id = p.id
  WHERE p.status = 'ACTIVE'
    AND (last_sale.at IS NULL OR last_sale.at < now() - make_interval(days => ${days}::int))
  ORDER BY value DESC, p.name`;

/** Desempenho por vendedor. */
export const sellersSql = (p: Period) => Prisma.sql`
  WITH ${bounds(p)}
  SELECT u.id, u.name,
         count(*) FILTER (WHERE s.status = 'COMPLETED')::int                         AS sales_count,
         count(*) FILTER (WHERE s.status = 'CANCELED')::int                          AS canceled_count,
         coalesce(sum(s.total_cents) FILTER (WHERE s.status = 'COMPLETED'), 0)::bigint AS net
  FROM sales s CROSS JOIN bounds b
  JOIN users u ON u.id = s.created_by_id
  WHERE ${inPeriod}
  GROUP BY u.id, u.name
  ORDER BY net DESC, u.name`;
