# ADR 0011: Vendas

- **Status:** aceito
- **Data:** 2026-10-10

## D23: venda atômica e ordem fixa de locks
Cabeçalho, itens e a baixa de estoque de cada item acontecem numa **única transação**. O módulo de
Estoque expõe `recordSaleOutflow(tx, …)` / `reverseSaleOutflow(tx, …)`, que recebem a transação de
quem chama: se o 3º item não tiver saldo, nada é gravado (nem venda, nem as baixas dos itens 1 e 2).

As baixas são feitas **sempre em ordem de `productId`** (na criação e no cancelamento). Sem isso,
as vendas `[A, B]` e `[B, A]` simultâneas podem formar um ciclo de espera (deadlock).

**Contraexemplo medido:** 10 pares de vendas em ordens opostas, sem ordenar e com 50 ms entre os
itens: **4 de 20 concluíram e 13 foram abortadas por deadlock**. Com a ordenação, o teste e2e com
15 pares conclui **30 de 30**.

## D24: fotografia de preço, produto e custo
Cada item guarda SKU, nome, unidade, preço unitário e **custo médio do instante da baixa**. O custo
vem do `RETURNING` da própria instrução que baixa o estoque, então fica exato mesmo com entradas
simultâneas. Renomear ou reprecificar um produto não altera vendas passadas.

O **cliente nunca envia preço**: o contrato aceita só `productId` e `quantity`, e o servidor usa o
preço vigente do catálogo. O custo não é exposto na API de vendas (dado gerencial, Fase 6).

## D25: número legível
`number` vem de uma sequence do Postgres (`autoincrement`). Uma venda que falha consome o número e
deixa um "buraco" (1041, 1043). Isso é intencional: numeração sem buracos exigiria serializar todas
as vendas. Há teste documentando esse comportamento.

## D26: desconto e arredondamento
Desconto no total, em valor (centavos) ou percentual (até 2 casas), rateado entre os itens
**proporcionalmente ao valor bruto pelo método do maior resto**: a soma dos descontos por item é
exatamente o desconto total. As contas ficam em `@mini-erp/contracts/sale-math.ts` (mesma conta no
front e na API) e usam `BigInt` nas multiplicações (quantidade em milésimos × preço passaria de 2^53).
Arredondamento: metade para cima, ao centavo.

## D27: cancelar, nunca apagar
`POST /sales/:id/cancel` (permissão `vendas:cancelar`, motivo obrigatório): na mesma transação,
`UPDATE ... WHERE status = 'COMPLETED'` (a trava contra cancelamento duplo) e estorno de cada saída
de estoque. A saída de venda não pode ser estornada pela tela de estoque: só pelo cancelamento.

## D28: pagamento
Registro simples (`CASH`, `PIX`, `DEBIT`, `CREDIT`), sem gateway. Só dinheiro tem troco; nos demais
meios o recebido é igual ao total. Criação idempotente (`Idempotency-Key`), como no estoque.

## Integridade no banco
`CHECK`s garantem `total = subtotal - desconto`, `troco = recebido - total`, troco só em dinheiro,
desconto ≤ subtotal, `líquido = bruto - desconto` por item e campos de cancelamento coerentes com
o status. Teto de R$ 10 milhões por venda (folga abaixo do `INTEGER`).

## D29: front
PDV com busca que aceita leitor de código de barras (correspondência exata de EAN/SKU + Enter
adiciona direto; ler de novo soma 1), carrinho com aviso de saldo, desconto, pagamento com troco e
prévia dos totais com a mesma função do servidor. Listagem com filtro por número/status, detalhe
e cancelamento. Quem tem `vendas:criar` cai direto no caixa ao entrar.
