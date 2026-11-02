-- AlterTable
ALTER TABLE "products" ADD COLUMN     "scale_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_scale_code_key" ON "products"("scale_code");


-- 6 dígitos exatos (a API completa com zeros à esquerda): a etiqueta traz sempre 6.
ALTER TABLE "products"
  ADD CONSTRAINT "products_scale_code_format" CHECK ("scale_code" ~ '^[0-9]{6}$'),
  ADD CONSTRAINT "products_scale_code_only_kg" CHECK ("scale_code" IS NULL OR "unit" = 'KG');
