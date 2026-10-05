-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRY', 'ADJUSTMENT', 'REVERSAL', 'SALE');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost_cents" INTEGER,
    "reason" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "balance_after" DECIMAL(14,3) NOT NULL,
    "reversal_of_id" UUID,
    "created_by_id" UUID NOT NULL,
    "idempotency_key" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avg_cost_cents" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_reversal_of_id_key" ON "stock_movements"("reversal_of_id");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_idempotency_key" ON "stock_movements"("created_by_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Regras de integridade (escritas à mão: o Prisma não modela CHECK) ──────

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_nonzero" CHECK ("quantity" <> 0),
  -- Entrada: sempre positiva e sempre com custo; os demais tipos nunca têm custo.
  ADD CONSTRAINT "stock_movements_entry_rules" CHECK (
    ("type" = 'ENTRY' AND "quantity" > 0 AND "unit_cost_cents" IS NOT NULL AND "unit_cost_cents" >= 0)
    OR ("type" <> 'ENTRY' AND "unit_cost_cents" IS NULL)
  ),
  -- Estorno, e somente estorno, aponta para a movimentação original.
  ADD CONSTRAINT "stock_movements_reversal_rules" CHECK (("type" = 'REVERSAL') = ("reversal_of_id" IS NOT NULL)),
  -- Ajuste sempre tem motivo.
  ADD CONSTRAINT "stock_movements_adjustment_reason" CHECK ("type" <> 'ADJUSTMENT' OR "reason" IS NOT NULL),
  ADD CONSTRAINT "stock_movements_balance_after_nonnegative" CHECK ("balance_after" >= 0);

-- Última linha de defesa: nenhum caminho de código consegue deixar o saldo negativo.
ALTER TABLE "stock_balances"
  ADD CONSTRAINT "stock_balances_quantity_nonnegative" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "stock_balances_avg_cost_nonnegative" CHECK ("avg_cost_cents" >= 0);

-- ─── Livro-razão imutável (D17) ─────────────────────────────────────────────
-- Erros se corrigem com ESTORNO (nova linha), nunca editando ou apagando o histórico.
-- TRUNCATE não dispara triggers de linha: continua possível para quem administra o banco
-- (usado pelos testes para limpar o banco de teste).

CREATE FUNCTION "stock_movements_block_changes"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements é imutável: % não permitido. Use um estorno.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_movements_immutable"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_block_changes"();
