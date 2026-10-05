-- Extensões usadas pelo catálogo (escritas à mão: o Prisma não as gera).
-- citext: texto que compara sem diferenciar maiúsculas (nome de categoria).
-- pg_trgm: índices trigram para busca parcial por nome/SKU.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('UN', 'CX', 'PC', 'KG', 'L', 'M');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "unit" "Unit" NOT NULL,
    "barcode" TEXT,
    "category_id" UUID,
    "sale_price_cents" INTEGER NOT NULL,
    "min_stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_sku_trgm_idx" ON "products" USING GIN ("sku" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras de integridade no banco (escritas à mão: o Prisma não modela CHECK).
-- Mesmo um bug na API ou um SQL manual não consegue gravar dados inválidos.
ALTER TABLE "products"
  ADD CONSTRAINT "products_sale_price_nonnegative" CHECK ("sale_price_cents" >= 0),
  ADD CONSTRAINT "products_min_stock_nonnegative" CHECK ("min_stock" >= 0),
  ADD CONSTRAINT "products_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "products_sku_uppercase" CHECK ("sku" = upper("sku")),
  ADD CONSTRAINT "products_barcode_digits" CHECK ("barcode" ~ '^([0-9]{8}|[0-9]{12,14})$');
