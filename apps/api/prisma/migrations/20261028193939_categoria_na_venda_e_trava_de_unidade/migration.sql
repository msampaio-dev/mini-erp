-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "category_id" UUID,
ADD COLUMN     "category_name" TEXT;

-- Backfill: vendas anteriores a esta migration não registraram a categoria do momento.
-- A melhor informação disponível é a categoria ATUAL do produto (ADR 0014).
UPDATE "sale_items" i
SET "category_id" = p."category_id", "category_name" = c."name"
FROM "products" p
LEFT JOIN "categories" c ON c."id" = p."category_id"
WHERE p."id" = i."product_id";

-- ─── Trava: unidade inteira com saldo fracionado ────────────────────────────
-- A unidade é do Catálogo; o saldo, do Estoque. A regra cruza os dois módulos, e o Catálogo
-- não pode consultar o Estoque (ADR 0001; criaria um ciclo, já que o Estoque depende dele).
-- O banco guarda o invariante sem acoplar os módulos; a API só traduz o erro.
CREATE FUNCTION "products_block_unit_with_fractional_stock"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "stock_balances" b
    WHERE b."product_id" = NEW."id" AND b."quantity" <> trunc(b."quantity")
  ) THEN
    RAISE EXCEPTION 'UNIT_FRACTIONAL_STOCK'
      USING ERRCODE = 'check_violation',
            DETAIL = 'O saldo atual do produto é fracionado; a unidade ' || NEW."unit" || ' só aceita inteiros.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "products_unit_guard"
  BEFORE UPDATE OF "unit" ON "products"
  FOR EACH ROW
  WHEN (OLD."unit" IS DISTINCT FROM NEW."unit" AND NEW."unit" NOT IN ('KG', 'L', 'M'))
  EXECUTE FUNCTION "products_block_unit_with_fractional_stock"();
