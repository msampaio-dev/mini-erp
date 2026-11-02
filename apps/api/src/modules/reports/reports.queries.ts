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

// NOT MATERIALIZED: usado por vendas E devoluções, o CTE seria materializado (calculado à parte)
// e o planejador perderia de vista as datas do período, trocando o hash join por um laço
// aninhado: margem por categoria em 1 ano foi de 77 ms para 254 ms (medido, ADR 0019).
const bounds = (p: Period) => Prisma.sql`
  bounds AS NOT MATERIALIZED (
    SELECT (${p.from}::date)::timestamp AT TIME ZONE ${tz} AS lo,
           ((${p.to}::date) + 1)::timestamp AT TIME ZONE ${tz} AS hi
  )`;

/** Itens com a venda e os limites do período (o filtro de status fica em cada consulta). */
const itemsWithSale = Prisma.sql`
  sale_items i
  JOIN sales s ON s.id = i.sale_id
  CROSS JOIN bounds b`;

const inPeriod = Prisma.sql`s.created_at >= b.lo AND s.created_at < b.hi`;

/**
 * Itens devolvidos NO PERÍODO (ADR 0019): a devolução abate receita e custo na data em que
 * acontece, não na data da venda. Assim um mês já fechado não muda quando alguém devolve depois.
 * O custo devolvido usa o custo fotografado na venda: a margem daquela unidade some por inteiro.
 */
const returnedInPeriod = Prisma.sql`
  sale_return_items ri
  JOIN sale_returns r ON r.id = ri.return_id
  JOIN sale_items i ON i.id = ri.sale_item_id
  JOIN sales s ON s.id = i.sale_id
  CROSS JOIN bounds b
  WHERE r.created_at >= b.lo AND r.created_at < b.hi`;

/**
 * Linhas que mexem na receita do período: itens vendidos (+) e itens devolvidos (−), cada um
 * na sua própria data. Margem, ABC e categorias somam esta lista.
 */
const revenueLines = Prisma.sql`
  lines AS (
    SELECT i.product_id, i.category_id, i.category_name,
           i.quantity, i.net_cents AS net, i.quantity * i.unit_cost_cents AS cost
    FROM ${itemsWithSale}
    WHERE s.status = 'COMPLETED' AND ${inPeriod}
    UNION ALL
    SELECT i.product_id, i.category_id, i.category_name,
           -ri.quantity, -ri.refund_cents, -(ri.quantity * i.unit_cost_cents)
    FROM ${returnedInPeriod}
  )`;

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
  ),
  ret AS (
    SELECT coalesce(sum(ri.refund_cents), 0)::bigint                    AS returns,
           coalesce(round(sum(ri.quantity * i.unit_cost_cents)), 0)::bigint AS returned_cost
    FROM ${returnedInPeriod}
  )
  SELECT head.sales_count, head.canceled_count, head.gross, head.discount,
         ret.returns, (head.net - ret.returns)::bigint AS net, (cost.cost - ret.returned_cost)::bigint AS cost
  FROM head, cost, ret`;

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
  ),
  ret AS (
    -- Devoluções no dia/semana/mês em que ACONTECERAM.
    SELECT date_trunc(${granularity}, r.created_at AT TIME ZONE ${tz})::date AS bucket,
           sum(ri.refund_cents)::bigint                       AS returns,
           round(sum(ri.quantity * i.unit_cost_cents))::bigint AS returned_cost
    FROM ${returnedInPeriod}
    GROUP BY 1
  )
  SELECT to_char(bk.bucket, 'YYYY-MM-DD') AS bucket,
         coalesce(sold.sales_count, 0)                                  AS sales_count,
         (coalesce(sold.net, 0) - coalesce(ret.returns, 0))::bigint     AS net,
         (coalesce(sold.net, 0) - coalesce(ret.returns, 0)
          - coalesce(cost.cost, 0) + coalesce(ret.returned_cost, 0))::bigint AS margin
  FROM buckets bk
  LEFT JOIN sold USING (bucket)
  LEFT JOIN cost USING (bucket)
  LEFT JOIN ret USING (bucket)
  ORDER BY bk.bucket`;

/** Margem por produto ou por categoria (receita líquida - custo fotografado). */
export const marginSql = (p: Period, groupBy: 'product' | 'category') => {
  // Produto: agrupa pela ENTIDADE e mostra o nome atual (renomear não cria "outro produto").
  // Categoria: usa a FOTOGRAFIA da venda (i.category_id): se o produto mudou de categoria, o
  // faturamento antigo fica na categoria antiga. Nome: o atual da categoria; se ela foi
  // excluída, o nome registrado na venda (ADR 0014).
  const key =
    groupBy === 'product'
      ? Prisma.sql`p.id AS id, p.sku AS sku, p.name AS name`
      : Prisma.sql`l.category_id AS id, NULL::text AS sku,
                   coalesce(c.name::text, max(l.category_name), 'Sem categoria') AS name`;
  const group = groupBy === 'product' ? Prisma.sql`p.id, p.sku, p.name` : Prisma.sql`l.category_id, c.name`;
  return Prisma.sql`
    WITH ${bounds(p)}, ${revenueLines}
    SELECT ${key},
           sum(l.quantity)::text        AS quantity,
           sum(l.net)::bigint           AS net,
           round(sum(l.cost))::bigint   AS cost
    FROM lines l
    JOIN products p ON p.id = l.product_id
    LEFT JOIN categories c ON c.id = l.category_id
    GROUP BY ${group}
    ORDER BY (sum(l.net) - round(sum(l.cost))) DESC, 3`;
};

/**
 * Curva ABC por faturamento. A window function `sum(...) OVER (ORDER BY ...)` calcula o
 * acumulado linha a linha sem subconsulta; `sum(...) OVER ()` dá o total geral.
 */
export const abcSql = (p: Period) => Prisma.sql`
  WITH ${bounds(p)},
  ${revenueLines},
  per_product AS (
    SELECT l.product_id, sum(l.net)::bigint AS net
    FROM lines l
    GROUP BY l.product_id
    HAVING sum(l.net) > 0
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
  WITH ${bounds(p)},
  sold AS (
    SELECT s.created_by_id AS user_id,
           count(*) FILTER (WHERE s.status = 'COMPLETED')::int                         AS sales_count,
           count(*) FILTER (WHERE s.status = 'CANCELED')::int                          AS canceled_count,
           coalesce(sum(s.total_cents) FILTER (WHERE s.status = 'COMPLETED'), 0)::bigint AS net
    FROM sales s CROSS JOIN bounds b
    WHERE ${inPeriod}
    GROUP BY s.created_by_id
  ),
  ret AS (
    -- A devolução pesa para quem fez a VENDA, na data da devolução.
    SELECT s.created_by_id AS user_id, sum(ri.refund_cents)::bigint AS returns
    FROM ${returnedInPeriod}
    GROUP BY s.created_by_id
  )
  SELECT u.id, u.name,
         coalesce(sold.sales_count, 0)::int    AS sales_count,
         coalesce(sold.canceled_count, 0)::int AS canceled_count,
         (coalesce(sold.net, 0) - coalesce(ret.returns, 0))::bigint AS net
  FROM sold FULL JOIN ret USING (user_id)
  JOIN users u ON u.id = coalesce(sold.user_id, ret.user_id)
  ORDER BY net DESC, u.name`;
