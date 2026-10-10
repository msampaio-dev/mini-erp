-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "subtotal_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "received_cents" INTEGER NOT NULL,
    "change_cents" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "idempotency_key" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceled_at" TIMESTAMPTZ,
    "canceled_by_id" UUID,
    "cancel_reason" TEXT,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "gross_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "unit_cost_cents" DECIMAL(18,4) NOT NULL,
    "stock_movement_id" UUID NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_number_key" ON "sales"("number");

-- CreateIndex
CREATE INDEX "sales_created_at_idx" ON "sales"("created_at" DESC);

-- CreateIndex
CREATE INDEX "sales_status_idx" ON "sales"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_idempotency_key" ON "sales"("created_by_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_stock_movement_id_key" ON "sale_items"("stock_movement_id");

-- CreateIndex
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_sale_id_product_id_key" ON "sale_items"("sale_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_sale_id_position_key" ON "sale_items"("sale_id", "position");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Regras de integridade (escritas à mão: o Prisma não modela CHECK) ──────
-- O banco garante que a conta de cada venda fecha, mesmo com bug na aplicação.

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_amounts_nonnegative" CHECK (
    "subtotal_cents" >= 0 AND "discount_cents" >= 0 AND "received_cents" >= 0 AND "change_cents" >= 0
  ),
  ADD CONSTRAINT "sales_discount_le_subtotal" CHECK ("discount_cents" <= "subtotal_cents"),
  ADD CONSTRAINT "sales_total_matches" CHECK ("total_cents" = "subtotal_cents" - "discount_cents"),
  ADD CONSTRAINT "sales_change_matches" CHECK ("change_cents" = "received_cents" - "total_cents"),
  -- Só dinheiro tem troco; nos demais meios o valor recebido é exatamente o total.
  ADD CONSTRAINT "sales_change_only_cash" CHECK ("payment_method" = 'CASH' OR "change_cents" = 0),
  -- Cancelada <=> tem data, autor e motivo do cancelamento.
  ADD CONSTRAINT "sales_cancel_fields" CHECK (
    ("status" = 'CANCELED') = ("canceled_at" IS NOT NULL)
    AND ("status" = 'CANCELED') = ("canceled_by_id" IS NOT NULL)
    AND ("status" = 'CANCELED') = ("cancel_reason" IS NOT NULL)
  );

ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "sale_items_amounts_nonnegative" CHECK (
    "unit_price_cents" >= 0 AND "gross_cents" >= 0 AND "discount_cents" >= 0 AND "unit_cost_cents" >= 0
  ),
  ADD CONSTRAINT "sale_items_net_matches" CHECK ("net_cents" = "gross_cents" - "discount_cents"),
  ADD CONSTRAINT "sale_items_discount_le_gross" CHECK ("discount_cents" <= "gross_cents");
