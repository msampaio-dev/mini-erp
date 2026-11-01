-- Invariantes que um backup RESTAURADO precisa cumprir (ADR 0017).
-- Usado pelo workflow de backup (GitHub Actions). Falha com exceção se algo estiver errado.
-- NÃO imprime contagens: os logs de um repositório público são públicos, e números de vendas
-- ou produtos revelariam o volume do negócio.
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL OR to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'backup sem o schema do sistema (dump de banco vazio?)';
  END IF;
  IF (SELECT count(*) FROM permissions) = 0 THEN
    RAISE EXCEPTION 'backup sem permissões (seed ausente)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sales s
    WHERE s.status = 'COMPLETED'
      AND s.total_cents <> (SELECT coalesce(sum(i.net_cents), 0) FROM sale_items i WHERE i.sale_id = s.id)
  ) THEN
    RAISE EXCEPTION 'venda concluída cujo total não bate com a soma dos itens';
  END IF;
  IF EXISTS (SELECT 1 FROM stock_balances WHERE quantity < 0) THEN
    RAISE EXCEPTION 'saldo de estoque negativo';
  END IF;
  -- O saldo materializado tem de bater com o livro-razão (a fonte da verdade, ADR 0002).
  IF EXISTS (
    SELECT 1 FROM stock_balances b
    WHERE b.quantity <> (SELECT coalesce(sum(m.quantity), 0) FROM stock_movements m WHERE m.product_id = b.product_id)
  ) THEN
    RAISE EXCEPTION 'saldo de estoque diferente da soma do livro-razão';
  END IF;
  RAISE NOTICE 'backup restaurado e consistente';
END $$;
