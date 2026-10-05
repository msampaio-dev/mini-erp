import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Operações atômicas sobre o saldo (ADR 0010). Cada função é UMA instrução SQL:
 * o Postgres trava a linha do saldo durante o UPDATE e, sob READ COMMITTED, quem
 * estava esperando reavalia o WHERE com o valor já atualizado. Por isso não há
 * "ler no Node, calcular, gravar": essa sequência teria condição de corrida.
 *
 * Quantidades trafegam como texto ("2.500") para o Postgres fazer a conta em NUMERIC
 * exato; nunca em float.
 */

type Tx = Prisma.TransactionClient;

export interface BalanceAfter {
  quantity: string;
  avgCostCents: string;
}

type Row = { quantity: string; avg_cost_cents: string };
const toBalance = (row: Row): BalanceAfter => ({ quantity: row.quantity, avgCostCents: row.avg_cost_cents });

/**
 * Entrada de compra: soma a quantidade e recalcula o custo médio ponderado.
 *   novo_custo = (saldo × custo_atual + qtd × custo_compra) / (saldo + qtd)
 * No ON CONFLICT, `b.*` é a linha ANTIGA e `EXCLUDED.*` são os valores da entrada:
 * a média sai de uma só instrução, sem ler antes.
 */
export async function inflowWithCost(tx: Tx, productId: string, qty: string, unitCostCents: number) {
  const [row] = await tx.$queryRaw<Row[]>`
    INSERT INTO stock_balances AS b (product_id, quantity, avg_cost_cents, updated_at)
    VALUES (${productId}::uuid, ${qty}::numeric, ${unitCostCents}::numeric, now())
    ON CONFLICT (product_id) DO UPDATE SET
      avg_cost_cents = ROUND(
        (b.quantity * b.avg_cost_cents + EXCLUDED.quantity * EXCLUDED.avg_cost_cents)
        / (b.quantity + EXCLUDED.quantity), 4),
      quantity = b.quantity + EXCLUDED.quantity,
      updated_at = now()
    RETURNING quantity::text, avg_cost_cents::text`;
  return toBalance(row!);
}

/** Entrada sem custo (ajuste positivo, estorno de saída): o custo médio não muda. */
export async function inflowAtCurrentCost(tx: Tx, productId: string, qty: string) {
  const [row] = await tx.$queryRaw<Row[]>`
    INSERT INTO stock_balances AS b (product_id, quantity, avg_cost_cents, updated_at)
    VALUES (${productId}::uuid, ${qty}::numeric, 0, now())
    ON CONFLICT (product_id) DO UPDATE SET
      quantity = b.quantity + EXCLUDED.quantity,
      updated_at = now()
    RETURNING quantity::text, avg_cost_cents::text`;
  return toBalance(row!);
}

/**
 * Saída: só baixa se houver saldo suficiente. Retorna null quando não há
 * (0 linhas afetadas) e o chamador transforma isso em "estoque insuficiente".
 */
export async function outflow(tx: Tx, productId: string, qty: string): Promise<BalanceAfter | null> {
  const [row] = await tx.$queryRaw<Row[]>`
    UPDATE stock_balances SET quantity = quantity - ${qty}::numeric, updated_at = now()
    WHERE product_id = ${productId}::uuid AND quantity >= ${qty}::numeric
    RETURNING quantity::text, avg_cost_cents::text`;
  return row ? toBalance(row) : null;
}

/**
 * Estorno de uma entrada de compra: retira a quantidade E desfaz o efeito dela no custo médio
 * (inverso da média ponderada). Se o saldo zerar, o custo médio é mantido.
 * Exige saldo: não dá para estornar mercadoria que já saiu.
 */
export async function reverseInflowWithCost(
  tx: Tx,
  productId: string,
  qty: string,
  unitCostCents: number,
): Promise<BalanceAfter | null> {
  const [row] = await tx.$queryRaw<Row[]>`
    UPDATE stock_balances SET
      avg_cost_cents = CASE
        WHEN quantity - ${qty}::numeric > 0 THEN GREATEST(ROUND(
          (quantity * avg_cost_cents - ${qty}::numeric * ${unitCostCents}::numeric)
          / (quantity - ${qty}::numeric), 4), 0)
        ELSE avg_cost_cents
      END,
      quantity = quantity - ${qty}::numeric,
      updated_at = now()
    WHERE product_id = ${productId}::uuid AND quantity >= ${qty}::numeric
    RETURNING quantity::text, avg_cost_cents::text`;
  return row ? toBalance(row) : null;
}

export async function currentQuantity(tx: Tx, productId: string): Promise<string> {
  const [row] = await tx.$queryRaw<{ quantity: string }[]>`
    SELECT quantity::text FROM stock_balances WHERE product_id = ${productId}::uuid`;
  return row?.quantity ?? '0';
}
