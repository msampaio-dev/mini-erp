-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'RETURN';

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "sale_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "refund_method" "PaymentMethod" NOT NULL,
    "refund_cents" INTEGER NOT NULL,
    "restock" BOOLEAN NOT NULL,
    "created_by_id" UUID NOT NULL,
    "idempotency_key" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_items" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "refund_cents" INTEGER NOT NULL,
    "stock_movement_id" UUID,

    CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_number_key" ON "sale_returns"("number");

-- CreateIndex
CREATE INDEX "sale_returns_sale_id_idx" ON "sale_returns"("sale_id");

-- CreateIndex
CREATE INDEX "sale_returns_created_at_idx" ON "sale_returns"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_idempotency_key" ON "sale_returns"("created_by_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_items_stock_movement_id_key" ON "sale_return_items"("stock_movement_id");

-- CreateIndex
CREATE INDEX "sale_return_items_sale_item_id_idx" ON "sale_return_items"("sale_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_items_return_id_sale_item_id_key" ON "sale_return_items"("return_id", "sale_item_id");

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Regras de integridade (escritas à mão: o Prisma não modela CHECK nem trigger) ──

-- Devolução sempre ENTRA no estoque. Compara como texto: o valor novo do enum só pode ser
-- usado depois do COMMIT desta migration (limitação do ALTER TYPE ... ADD VALUE).
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_return_positive" CHECK ("type"::text <> 'RETURN' OR "quantity" > 0);

ALTER TABLE "sale_returns"
  ADD CONSTRAINT "sale_returns_refund_nonnegative" CHECK ("refund_cents" >= 0),
  ADD CONSTRAINT "sale_returns_reason_present" CHECK (length(trim("reason")) >= 3);

ALTER TABLE "sale_return_items"
  ADD CONSTRAINT "sale_return_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "sale_return_items_refund_nonnegative" CHECK ("refund_cents" >= 0);

-- Conferência no COMMIT (a devolução e os itens são gravados em instruções separadas):
-- 1. o reembolso da devolução é a soma dos itens;
-- 2. item tem entrada no estoque <=> a devolução volta a mercadoria ao estoque;
-- 3. nunca se devolve mais do que foi vendido, nem se reembolsa mais do que foi pago pelo item.
CREATE FUNCTION "sale_returns_check"() RETURNS trigger AS $$
DECLARE
  rid uuid;
  r record;
  bad record;
BEGIN
  IF TG_TABLE_NAME = 'sale_returns' THEN
    rid := NEW.id;
  ELSE
    rid := NEW.return_id;
  END IF;
  SELECT * INTO r FROM sale_returns WHERE id = rid;
  IF r.refund_cents <> (SELECT coalesce(sum(refund_cents), 0) FROM sale_return_items WHERE return_id = rid) THEN
    RAISE EXCEPTION 'devolução %: reembolso diferente da soma dos itens', rid USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM sale_return_items WHERE return_id = rid AND (stock_movement_id IS NOT NULL) <> r.restock) THEN
    RAISE EXCEPTION 'devolução %: entrada no estoque não confere com "volta ao estoque"', rid USING ERRCODE = 'check_violation';
  END IF;
  SELECT i.id INTO bad
  FROM sale_items i
  JOIN (SELECT sale_item_id, sum(quantity) AS qty, sum(refund_cents) AS refund
        FROM sale_return_items
        WHERE sale_item_id IN (SELECT sale_item_id FROM sale_return_items WHERE return_id = rid)
        GROUP BY sale_item_id) t ON t.sale_item_id = i.id
  WHERE t.qty > i.quantity OR t.refund > i.net_cents
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'item de venda %: devolvido além do vendido', bad.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "sale_returns_consistent"
  AFTER INSERT ON "sale_returns"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "sale_returns_check"();

CREATE CONSTRAINT TRIGGER "sale_return_items_consistent"
  AFTER INSERT ON "sale_return_items"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "sale_returns_check"();

-- Devolução é documento: não se edita nem se apaga (como o livro-razão).
CREATE FUNCTION "sale_returns_block_changes"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% é imutável: % não permitido.', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sale_returns_immutable"
  BEFORE UPDATE OR DELETE ON "sale_returns"
  FOR EACH ROW EXECUTE FUNCTION "sale_returns_block_changes"();

CREATE TRIGGER "sale_return_items_immutable"
  BEFORE UPDATE OR DELETE ON "sale_return_items"
  FOR EACH ROW EXECUTE FUNCTION "sale_returns_block_changes"();

-- Venda com devolução não pode ser cancelada: o cancelamento devolveria ao estoque (e ao
-- cliente) de novo o que já voltou. O restante sai por outra devolução.
CREATE FUNCTION "sales_cancel_without_returns"() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'CANCELED' AND OLD.status <> 'CANCELED'
     AND EXISTS (SELECT 1 FROM sale_returns WHERE sale_id = NEW.id) THEN
    RAISE EXCEPTION 'venda % tem devolução e não pode ser cancelada', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_no_cancel_after_return"
  BEFORE UPDATE OF "status" ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "sales_cancel_without_returns"();
