# ADR 0018: Caixa (abertura, sangria, fechamento) e pagamento dividido

- **Status:** aceito
- **Data:** 2026-11-02
- **Parte de:** plano de uso real (`docs/plano-uso-real.md`, seção 2)

## Contexto
Até aqui a venda registrava o meio de pagamento, mas ninguém conseguia responder à pergunta do fim
do dia numa loja: **quanto dinheiro deveria haver na gaveta?** Também não dava para pagar uma
compra com parte no Pix e parte em dinheiro, coisa diária no varejo.

## Decisões

### D44. Sessão de caixa por operador, obrigatória para vender
Cada operador abre o **seu** caixa, com o troco inicial, e toda venda pertence a uma sessão.
- **Por operador, e não por terminal:** num sistema web não existe uma identidade confiável do
  computador, e "a gaveta é de quem está logado" é a regra mais simples de auditar.
- **Um caixa aberto por operador,** garantido por um **índice único parcial**
  (`operator_id WHERE closed_at IS NULL`). Cinco cliques simultâneos em "Abrir caixa" abrem um
  só caixa, sem consulta prévia com condição de corrida.
- As vendas antigas ficam com `cash_session_id` nulo: são anteriores ao controle de caixa.

### D45. Pagamento dividido em `sale_payments`
Uma linha por forma de pagamento. Em dinheiro, o valor é o **entregue** pelo cliente; o troco sai dele.
- Duas regras bastam: **cartão + Pix não passam do total** (troco só em dinheiro) e **tudo somado
  cobre o total**. A função `settlePayments` fica em `@mini-erp/contracts`, a mesma no PDV
  (prévia) e na API (autoridade).
- O banco confere a soma no **COMMIT**, com um *constraint trigger* `DEFERRABLE INITIALLY
  DEFERRED`: venda e pagamentos são gravados em instruções separadas, então uma `CHECK` comum não
  serve. Testado: alterar um pagamento direto no banco é recusado.
- A migration copia o meio de pagamento de cada venda existente para `sale_payments` **antes** de
  remover a coluna antiga. Em produção, nenhuma venda perde o pagamento.

### D46. Livro do caixa e fechamento cego
- O dinheiro da gaveta é um **livro-razão** (`cash_movements`), como o estoque (ADR 0002):
  abertura, suprimento, sangria, venda em dinheiro, cancelamento e devolução. É **imutável**
  (trigger) e cada tipo tem um sinal obrigatório (uma "sangria" não consegue pôr dinheiro).
  **Esperado = soma das movimentações**, nunca um número digitado.
- Só o **líquido** em dinheiro entra: nota de R$ 50 para uma compra de R$ 30 registra +R$ 30.
- **Fechamento cego:** o operador informa o dinheiro contado **sem ver** o esperado; o resultado
  aparece depois do fechamento. Se o operador vê quanto "deveria" ter, a contagem tende a
  "bater" sozinha. O gerente (`caixa:gerenciar`) vê o esperado a qualquer momento.
- **Concorrência no fechamento:** a venda segura a sessão com `FOR SHARE` até o COMMIT; o
  fechamento pede `FOR UPDATE`. O fechamento espera as vendas em andamento terminarem, e as
  seguintes encontram o caixa fechado. Um trigger também impede movimentação em caixa fechado.
  Testado com 20 vendas disputando com o fechamento: toda venda aceita está no esperado gravado.
- **Sangria:** a sessão é travada com `FOR UPDATE` e a sangria não pode passar do dinheiro
  registrado. A mensagem de erro não revela o valor (fechamento cego). Testado: 5 sangrias
  simultâneas de R$ 30 com R$ 100 na gaveta deixam passar 3.
- Caixa fechado **não reabre**: o fechamento é final (trigger). O gerente pode fechar o caixa
  esquecido de outra pessoa.

### D47. De onde sai o dinheiro do cancelamento
Cancelar uma venda paga em dinheiro tira o valor da gaveta:
1. da **gaveta da própria venda**, se aquele caixa ainda estiver aberto (o caso comum,
   "registrei errado"), mesmo que quem cancela seja o gerente;
2. senão, da gaveta **de quem está cancelando**;
3. sem gaveta aberta, a API recusa: não há de onde tirar o dinheiro.

Venda no Pix ou no cartão cancela sem caixa: o estorno acontece fora da gaveta.

## Permissões
- `caixa:operar`: abrir, movimentar e fechar o próprio caixa (Vendedor, Gerente, Admin).
- `caixa:gerenciar`: ver todos os caixas, com esperado e diferença, e fechar o de outra pessoa (Gerente, Admin).

## Consequências
- **Mudança de contrato:** `payment: { method, receivedCents }` virou `payments: [{ method, amountCents }]`,
  e a venda passou a trazer `payments` e `cashSessionId`. Front, testes e scripts foram atualizados juntos.
- Quem só vende precisa abrir o caixa antes. O PDV mostra "Caixa fechado" com o atalho para abrir.
- O backup diário (ADR 0017) passou a conferir também a soma dos pagamentos e o esperado de cada caixa fechado.
- A falta ou sobra fica **registrada**, mas o sistema não "corrige" nada: a diferença é informação para o gerente.
