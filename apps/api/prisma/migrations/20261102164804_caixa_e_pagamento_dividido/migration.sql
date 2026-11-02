-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING', 'SUPPLY', 'WITHDRAWAL', 'SALE', 'SALE_CANCEL', 'REFUND');

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_cents" INTEGER NOT NULL,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- Vendas já existentes: o meio único vira uma linha de pagamento ANTES de a coluna sumir.
-- Em dinheiro, o valor entregue é o recebido (inclui o troco), como nas vendas novas.
INSERT INTO "sale_payments" ("id", "sale_id", "method", "amount_cents")
SELECT uuidv7(), "id", "payment_method", "received_cents" FROM "sales";

-- AlterTable (a CHECK sales_change_only_cash usa a coluna e sai junto; a regra passa ao trigger abaixo)
ALTER TABLE "sales" DROP COLUMN "payment_method",
ADD COLUMN     "cash_session_id" UUID;

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "operator_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_cents" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "closed_by_id" UUID,
    "expected_cents" INTEGER,
    "counted_cents" INTEGER,
    "difference_cents" INTEGER,
    "closing_note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "sale_id" UUID,
    "created_by_id" UUID NOT NULL,
    "idempotency_key" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_payments_sale_id_method_key" ON "sale_payments"("sale_id", "method");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_number_key" ON "cash_sessions"("number");

-- CreateIndex
CREATE INDEX "cash_sessions_operator_id_opened_at_idx" ON "cash_sessions"("operator_id", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "cash_sessions_opened_at_idx" ON "cash_sessions"("opened_at" DESC);

-- CreateIndex
CREATE INDEX "cash_movements_session_id_created_at_idx" ON "cash_movements"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "cash_movements_sale_id_idx" ON "cash_movements"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_idempotency_key" ON "cash_movements"("created_by_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "sales_cash_session_id_idx" ON "sales"("cash_session_id");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Regras de integridade (escritas à mão: o Prisma não modela CHECK nem trigger) ──

ALTER TABLE "sale_payments"
  ADD CONSTRAINT "sale_payments_amount_nonnegative" CHECK ("amount_cents" >= 0);

-- Pagamento dividido (D45): no FIM da transação, a soma dos pagamentos tem de ser o recebido
-- e o troco não pode passar do que foi entregue em dinheiro. DEFERRABLE INITIALLY DEFERRED:
-- a venda e os pagamentos são gravados em instruções separadas; a conferência espera o COMMIT.
CREATE FUNCTION "sale_payments_check"() RETURNS trigger AS $$
DECLARE
  sid uuid;
  paid bigint;
  cash bigint;
  s record;
BEGIN
  -- IFs separados: o PL/pgSQL resolve NEW.sale_id mesmo num CASE que não o escolhe, e "sales" não tem essa coluna.
  IF TG_TABLE_NAME = 'sales' THEN
    sid := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    sid := OLD.sale_id;
  ELSE
    sid := NEW.sale_id;
  END IF;
  SELECT received_cents, change_cents INTO s FROM sales WHERE id = sid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(sum(amount_cents), 0), coalesce(sum(amount_cents) FILTER (WHERE method = 'CASH'), 0)
    INTO paid, cash FROM sale_payments WHERE sale_id = sid;
  IF paid <> s.received_cents THEN
    RAISE EXCEPTION 'venda %: pagamentos somam % e o recebido é %', sid, paid, s.received_cents
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sale_payments_match_received';
  END IF;
  IF s.change_cents > cash THEN
    RAISE EXCEPTION 'venda %: troco maior que o valor em dinheiro', sid
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sale_payments_change_only_cash';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "sales_payments_match"
  AFTER INSERT OR UPDATE OF "received_cents", "change_cents" ON "sales"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "sale_payments_check"();

CREATE CONSTRAINT TRIGGER "sale_payments_match"
  AFTER INSERT OR UPDATE OR DELETE ON "sale_payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "sale_payments_check"();

-- Caixa (D44): no máximo UMA sessão aberta por operador. Índice único PARCIAL: só as linhas
-- com closed_at nulo entram nele, então sessões fechadas não conflitam entre si.
CREATE UNIQUE INDEX "cash_sessions_one_open_per_operator" ON "cash_sessions" ("operator_id") WHERE "closed_at" IS NULL;

ALTER TABLE "cash_sessions"
  ADD CONSTRAINT "cash_sessions_opening_nonnegative" CHECK ("opening_cents" >= 0),
  -- Fechada <=> tem data, autor, esperado, contado e diferença.
  ADD CONSTRAINT "cash_sessions_close_fields" CHECK (
    ("closed_at" IS NULL) = ("closed_by_id" IS NULL)
    AND ("closed_at" IS NULL) = ("expected_cents" IS NULL)
    AND ("closed_at" IS NULL) = ("counted_cents" IS NULL)
    AND ("closed_at" IS NULL) = ("difference_cents" IS NULL)
  ),
  ADD CONSTRAINT "cash_sessions_counted_nonnegative" CHECK ("counted_cents" >= 0),
  ADD CONSTRAINT "cash_sessions_difference_matches" CHECK ("difference_cents" = "counted_cents" - "expected_cents");

-- O sinal de cada movimentação é definido pelo tipo: ninguém registra uma "sangria" que põe dinheiro.
ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_sign" CHECK (
    CASE "type"
      WHEN 'OPENING' THEN "amount_cents" >= 0
      WHEN 'SUPPLY' THEN "amount_cents" > 0
      WHEN 'SALE' THEN "amount_cents" > 0
      ELSE "amount_cents" < 0
    END
  ),
  -- Movimentação de venda (e só ela) aponta para a venda.
  ADD CONSTRAINT "cash_movements_sale_link" CHECK (("type" IN ('SALE', 'SALE_CANCEL', 'REFUND')) = ("sale_id" IS NOT NULL));

-- Livro do caixa imutável, como o de estoque (D17): erro se corrige com nova movimentação.
CREATE FUNCTION "cash_movements_block_changes"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cash_movements é imutável: % não permitido.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cash_movements_immutable"
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION "cash_movements_block_changes"();

-- Caixa fechado não recebe movimentação: o esperado gravado no fechamento não pode mudar depois.
-- FOR SHARE trava a sessão contra um fechamento simultâneo até esta transação terminar.
CREATE FUNCTION "cash_movements_require_open_session"() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM cash_sessions WHERE id = NEW.session_id AND closed_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sessão de caixa % está fechada', NEW.session_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'cash_movements_session_open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cash_movements_session_open"
  BEFORE INSERT ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION "cash_movements_require_open_session"();

-- Sessão fechada não volta a abrir, e o fechamento não é reescrito. (Excluir uma sessão já é
-- impossível: a FK das movimentações impede, e toda sessão tem ao menos a de abertura.)
CREATE FUNCTION "cash_sessions_close_once"() RETURNS trigger AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'sessão de caixa % já está fechada', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cash_sessions_closed_is_final"
  BEFORE UPDATE ON "cash_sessions"
  FOR EACH ROW EXECUTE FUNCTION "cash_sessions_close_once"();
