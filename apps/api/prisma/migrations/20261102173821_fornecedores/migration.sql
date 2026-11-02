-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "invoice_number" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "supplier_id" UUID;

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_document_key" ON "suppliers"("document");

-- CreateIndex
CREATE INDEX "suppliers_name_trgm_idx" ON "suppliers" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "stock_movements_supplier_id_created_at_idx" ON "stock_movements"("supplier_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Regras de integridade (escritas à mão) ───────────────────────────────

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_document_digits" CHECK ("document" ~ '^([0-9]{11}|[0-9]{14})$');

-- Fornecedor e nota fiscal só fazem sentido numa ENTRADA de compra.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_supplier_only_entry" CHECK (
    "type" = 'ENTRY' OR ("supplier_id" IS NULL AND "invoice_number" = '')
  );
