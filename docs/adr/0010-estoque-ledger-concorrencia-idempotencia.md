# ADR 0010: Estoque: livro-razão, concorrência, custo médio e idempotência

- **Status:** aceito
- **Data:** 2026-10-05
- **Implementa:** ADR 0002

## Modelo
- `stock_movements`: livro-razão **append-only**. Cada linha tem tipo, quantidade **com sinal**,
  custo (só em entradas), motivo (só em ajustes), autor e o **saldo logo após** (`balance_after`),
  que forma a coluna de saldo do kardex sem nenhum cálculo.
- `stock_balances`: saldo e custo médio atuais por produto, atualizados **na mesma transação**
  que grava a movimentação.

## D17: imutável no banco
Um trigger `BEFORE UPDATE OR DELETE` em `stock_movements` lança exceção. Erros se corrigem com
estorno. `TRUNCATE` não dispara triggers de linha e continua disponível para administração e testes.

## D18: concorrência sem lock manual
Toda alteração de saldo é **uma única instrução SQL** (`apps/api/src/modules/inventory/stock-ledger.ts`):

```sql
UPDATE stock_balances SET quantity = quantity - :q
 WHERE product_id = :id AND quantity >= :q
RETURNING quantity;   -- 0 linhas = estoque insuficiente (409 INSUFFICIENT_STOCK)
```

Sob `READ COMMITTED`, um UPDATE que esperou pelo lock da linha **reavalia o WHERE** com o valor
já confirmado pela transação anterior. Não é preciso `SELECT ... FOR UPDATE` nem `SERIALIZABLE`.
`CHECK (quantity >= 0)` é a última linha de defesa.

**Contraexemplo medido:** a abordagem "ler no Node → conferir → gravar", com 20 saídas simultâneas
contra saldo 10, aprovou **20** saídas e terminou com saldo **9**. A versão atômica aprova
exatamente 10 e termina em 0 (teste e2e, estável em execuções repetidas).

## D19: tipos fechados
| Tipo | Sinal | Regras (garantidas por `CHECK`) |
|---|---|---|
| `ENTRY` | + | custo unitário obrigatório |
| `ADJUSTMENT` | ± | motivo obrigatório (`AVARIA`, `PERDA`, `INVENTARIO`, `OUTRO` + descrição) |
| `REVERSAL` | inverso da original | `reversal_of_id` obrigatório e **único**: um estorno por movimentação |
| `SALE` | − | reservado ao módulo de Vendas (Fase 5) |

Não se estorna um estorno, nem uma venda (que se desfaz cancelando a venda). Estornar uma entrada
exige que a mercadoria ainda esteja em estoque.

## D20: custo médio ponderado móvel
`novo = (saldo × custo_atual + qtd × custo_compra) / (saldo + qtd)`, calculado no próprio
`INSERT ... ON CONFLICT DO UPDATE` (a linha antiga e os valores novos estão disponíveis na mesma
instrução). Guardado com 4 casas decimais de centavo. Saídas e ajustes não alteram o custo médio;
o estorno de uma entrada aplica a operação inversa da média.
Alternativa descartada: PEPS/FIFO por lote (exige rastrear camadas de custo; desnecessário aqui).

## D21: idempotência
As escritas exigem o cabeçalho `Idempotency-Key` (UUID gerado pelo cliente **por operação**).
- Única por usuário: `UNIQUE (created_by_id, idempotency_key)`.
- Repetição: devolve a movimentação original com **200** + `Idempotent-Replayed: true`.
- Corrida (mesma chave em paralelo): o UNIQUE barra a segunda, e **toda** a transação dela
  (inclusive o saldo) é desfeita; a resposta é a da vencedora.
- Mesma chave com dados diferentes: **422** `IDEMPOTENCY_KEY_REUSED`.

## Limites conhecidos
- Mudar a unidade de um produto com saldo fracionado (KG → UN) não é bloqueado; tratar se virar
  necessidade real.
- O saldo é exibido na listagem de produtos com uma requisição em lote por página
  (`GET /inventory/balances?productIds=...`); a composição Catálogo + Estoque é feita no front.
