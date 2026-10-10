/**
 * Medição de desempenho dos relatórios (ADR 0012, D35).
 *
 *   npm run perf:reports -w @mini-erp/api            # gera a massa (se preciso) e mede
 *   npm run perf:reports -w @mini-erp/api -- --reset # recria a massa do zero
 *
 * Usa um banco SEPARADO (<banco>_perf): nunca toca nos dados de desenvolvimento.
 * Mede as MESMAS consultas que o ReportsService executa (reports.queries.ts) com
 * EXPLAIN (ANALYZE, BUFFERS): tempo real de execução no Postgres, sem rede nem Node.
 */
import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import * as q from '../src/modules/reports/reports.queries.js';

const SALES = 50_000;
const PRODUCTS = 500;
const RUNS = 5;

try {
  process.loadEnvFile();
} catch {
  // sem .env
}
const url = new URL(process.env['DATABASE_URL']!);
url.pathname = `${url.pathname.replace(/_(test|perf)$/, '')}_perf`;
const dbName = url.pathname.slice(1);

async function ensureDatabase() {
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'ignore' });
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });

/** Gera a massa inteira em SQL (generate_series): segundos, em vez de minutos via API. */
async function seed() {
  console.log(`Gerando ${SALES.toLocaleString('pt-BR')} vendas em ${PRODUCTS} produtos...`);
  const t0 = performance.now();
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, sessions, user_roles, categories, products, stock_movements, stock_balances, sales, sale_items CASCADE',
  );
  const steps = [
    `INSERT INTO users (id, name, email, password_hash, updated_at)
     SELECT gen_random_uuid(), 'Vendedor ' || g, 'v' || g || '@perf.local', 'x', now() FROM generate_series(1, 5) g`,
    `INSERT INTO categories (id, name) SELECT gen_random_uuid(), 'Categoria ' || g FROM generate_series(1, 20) g`,
    `INSERT INTO products (id, sku, name, unit, category_id, sale_price_cents, min_stock, updated_at)
     SELECT gen_random_uuid(), 'P' || lpad(g::text, 5, '0'), 'Produto ' || g, 'UN',
            (SELECT id FROM categories ORDER BY name OFFSET (g % 20) LIMIT 1),
            100 + (g * 7919) % 20000, (g % 30), now()
     FROM generate_series(1, ${PRODUCTS}) g`,
    `INSERT INTO stock_balances (product_id, quantity, avg_cost_cents, updated_at)
     SELECT id, (row_number() OVER (ORDER BY sku)) % 200, sale_price_cents * 0.6, now() FROM products`,
    // Vendas: datas espalhadas no último ano; ~3% canceladas.
    `CREATE TEMP TABLE gen_sales AS
     SELECT g, gen_random_uuid() AS id,
            (SELECT id FROM users ORDER BY email OFFSET (g % 5) LIMIT 1) AS seller,
            now() - random() * interval '365 days' AS created_at,
            random() < 0.03 AS canceled,
            -- produto "base" com viés de Pareto (poucos vendem muito)
            floor(${PRODUCTS} * power(random(), 3))::int AS base
     FROM generate_series(1, ${SALES}) g`,
    // 1 a 5 itens por venda, produtos distintos dentro da venda (passo 97, coprimo com 500).
    `CREATE TEMP TABLE gen_items AS
     WITH p AS (SELECT array_agg(id ORDER BY sku) AS ids, array_agg(sale_price_cents ORDER BY sku) AS prices FROM products)
     SELECT s.id AS sale_id, s.seller, s.created_at, n AS position, gen_random_uuid() AS movement_id,
            p.ids[(s.base + n * 97) % ${PRODUCTS} + 1] AS product_id,
            p.prices[(s.base + n * 97) % ${PRODUCTS} + 1] AS price,
            1 + (s.g * 31 + n) % 4 AS qty
     FROM gen_sales s, p, generate_series(0, 4) n
     WHERE n < 1 + s.g % 5`,
    `INSERT INTO stock_movements (id, product_id, type, quantity, balance_after, created_by_id, created_at, note)
     SELECT movement_id, product_id, 'SALE', -qty, 0, seller, created_at, 'perf' FROM gen_items`,
    `INSERT INTO sales (id, subtotal_cents, discount_cents, total_cents, payment_method, received_cents, change_cents,
                        created_by_id, created_at, status, canceled_at, canceled_by_id, cancel_reason)
     SELECT s.id, t.total, 0, t.total, 'PIX', t.total, 0, s.seller, s.created_at,
            CASE WHEN s.canceled THEN 'CANCELED' ELSE 'COMPLETED' END::"SaleStatus",
            CASE WHEN s.canceled THEN s.created_at END,
            CASE WHEN s.canceled THEN s.seller END,
            CASE WHEN s.canceled THEN 'perf' END
     FROM gen_sales s JOIN (SELECT sale_id, sum(qty * price) AS total FROM gen_items GROUP BY sale_id) t ON t.sale_id = s.id`,
    `INSERT INTO sale_items (id, sale_id, position, product_id, sku, name, unit, quantity, unit_price_cents,
                             gross_cents, discount_cents, net_cents, unit_cost_cents, stock_movement_id)
     SELECT gen_random_uuid(), i.sale_id, i.position, i.product_id, p.sku, p.name, p.unit, i.qty, i.price,
            i.qty * i.price, 0, i.qty * i.price, i.price * 0.6, i.movement_id
     FROM gen_items i JOIN products p ON p.id = i.product_id`,
    `ANALYZE`,
  ];
  for (const sql of steps) await prisma.$executeRawUnsafe(sql);
  const [{ items }] = await prisma.$queryRawUnsafe<{ items: bigint }[]>('SELECT count(*) AS items FROM sale_items');
  console.log(`  ${Number(items).toLocaleString('pt-BR')} itens de venda em ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
}

/** Roda EXPLAIN ANALYZE algumas vezes e devolve a mediana do tempo de execução + nós de varredura. */
async function measure(sql: Prisma.Sql) {
  const times: number[] = [];
  let scans = new Set<string>();
  for (let i = 0; i < RUNS; i++) {
    const [row] = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': unknown }[]>(
      // .text usa placeholders $1, $2 (Postgres); .sql usaria "?" (estilo MySQL).
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql.text}`,
      ...sql.values,
    );
    const plan = (row!['QUERY PLAN'] as [{ 'Execution Time': number; Plan: unknown }])[0];
    times.push(plan['Execution Time']);
    scans = new Set<string>();
    const walk = (node: { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: unknown[] }) => {
      if (node['Relation Name'] && !node['Relation Name'].startsWith('gen_')) {
        scans.add(`${node['Node Type']}(${node['Index Name'] ?? node['Relation Name']})`);
      }
      node.Plans?.forEach((child) => walk(child as typeof node));
    };
    walk(plan.Plan as Parameters<typeof walk>[0]);
  }
  times.sort((a, b) => a - b);
  return { ms: times[Math.floor(RUNS / 2)]!, scans: [...scans].join(', ') };
}

function isoDaysAgo(days: number) {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

await ensureDatabase();
const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>('SELECT count(*) AS count FROM sales');
if (process.argv.includes('--reset') || Number(count) < SALES) await seed();
else console.log(`Usando massa existente em ${dbName} (${Number(count).toLocaleString('pt-BR')} vendas). --reset recria.\n`);

const today = isoDaysAgo(0);
const month = { from: isoDaysAgo(29), to: today };
const year = { from: isoDaysAgo(364), to: today };

const cases: [string, Prisma.Sql][] = [
  ['Totais (30 dias)', q.salesTotalsSql(month)],
  ['Série diária (30 dias)', q.salesSeriesSql(month, 'day')],
  ['Totais (1 ano)', q.salesTotalsSql(year)],
  ['Série mensal (1 ano)', q.salesSeriesSql(year, 'month')],
  ['Margem por produto (30 dias)', q.marginSql(month, 'product')],
  ['Margem por categoria (1 ano)', q.marginSql(year, 'category')],
  ['Curva ABC (1 ano)', q.abcSql(year)],
  ['Vendedores (1 ano)', q.sellersSql(year)],
  ['Valor do estoque', q.inventoryValueSql()],
  ['Reposição', q.reorderSql()],
  ['Produtos parados (60 dias)', q.staleSql(60)],
];

console.log(`Mediana de ${RUNS} execuções (EXPLAIN ANALYZE):\n`);
for (const [name, sql] of cases) {
  const { ms, scans } = await measure(sql);
  console.log(`${name.padEnd(30)} ${ms.toFixed(1).padStart(8)} ms   ${scans}`);
}
await prisma.$disconnect();
