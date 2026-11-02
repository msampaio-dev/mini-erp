# ADR 0019: Devolução parcial

- **Status:** aceito
- **Data:** 2026-11-02
- **Parte de:** plano de uso real (`docs/plano-uso-real.md`, seção 2)

## Contexto
Só existia o cancelamento da venda **inteira**. No varejo, o comum é o cliente voltar com um item
(ou parte dele): uma das três cervejas estava quente, o pacote veio violado. Cancelar e vender de
novo deixaria rastro errado (venda cancelada que não foi cancelada) e mexeria no caixa duas vezes.

## Decisões

### D48. A devolução é um documento à parte; a venda não muda
`sale_returns` + `sale_return_items`, com número próprio. A venda continua `COMPLETED`, com os
mesmos valores, e passa a mostrar quanto de cada item já voltou. Mesma filosofia do livro-razão
(ADR 0002): o registro original não é reescrito, a correção é um registro novo. Devoluções são
**imutáveis** (trigger).

### D49. Reembolso proporcional ao líquido, arredondado pelo ACUMULADO
O reembolso de um item é proporcional ao que o cliente **pagou** por ele, com o desconto da venda
já rateado (D26). O cálculo é feito pelo acumulado:

    reembolso = arred(líquido × devolvido_até_agora / vendido) − já_reembolsado

Arredondar cada devolução isoladamente erra: R$ 5,00 por 10 unidades devolvidas uma a uma, com
arredondamento para cima, dariam R$ 9,00 em nove devoluções. Pelo acumulado, a soma nunca passa
do líquido, e devolver tudo reembolsa **exatamente** o que foi pago. Exemplo testado: R$ 1,00 por
3 unidades devolvidas uma a uma = 33 + 34 + 33 centavos. A função `returnRefundCents` fica em
`@mini-erp/contracts`, a mesma na prévia da tela e na API.

### D50. Concorrência: a venda é travada durante a devolução
`SELECT ... FROM sales WHERE id = ? FOR UPDATE` no início da transação. Duas devoluções da mesma
venda, ou devolução e cancelamento simultâneos, acontecem uma de cada vez, e "quanto ainda pode
voltar" é lido **depois** do lock. Testado: 5 devoluções simultâneas de 1 unidade numa venda de 3
deixam passar exatamente 3. Sem o `FOR UPDATE` o teste falha (mutação conferida).

O banco confere no COMMIT (trigger adiado) que nenhum item volta além do vendido nem é
reembolsado além do pago, mesmo se alguém gravar direto no banco.

### D51. Estoque: tipo `RETURN`, com opção de não voltar à venda
- A mercadoria volta pelo tipo novo `RETURN`, e não por estorno: uma saída de venda pode ter
  várias devoluções parciais, e o estorno é único por movimentação (`reversal_of_id` UNIQUE).
  Entra ao custo médio atual, como no cancelamento.
- `restock = false` para produto com defeito ou vencido: o cliente é reembolsado, mas nada entra
  no estoque. Se o produto ainda está na loja, a perda deve ser lançada como ajuste de avaria.

### D52. Venda com devolução não se cancela
Cancelar devolveria ao estoque e ao cliente, de novo, o que já voltou. O restante sai por outra
devolução. Garantido na API (409 `SALE_HAS_RETURNS`) e por trigger no banco.

### D53. Reembolso em dinheiro sai da gaveta
Mesma regra do cancelamento (D47): da gaveta da venda, se ainda aberta; senão, da de quem
devolve; sem gaveta aberta, a API recusa. Pix e cartão não passam pela gaveta: o estorno é feito
no app do banco ou na maquininha, e o sistema registra o meio usado.

### D54. Relatórios: a devolução conta na data em que acontece
A devolução abate receita e custo **no período da devolução**, não no da venda. Um mês fechado não
muda de número porque alguém devolveu algo no mês seguinte (é também como a contabilidade trata
devolução de venda). O custo abatido é o fotografado na venda, então a margem daquela unidade
some por inteiro. O total do período ganha o campo `returnsCents`, e a receita líquida já vem
descontada. Para o vendedor, a devolução pesa sobre quem fez a venda.

**Desempenho, medido com 50 mil vendas** (`npm run perf:reports`): o CTE de período passou a ser
usado por vendas **e** devoluções. Usado duas vezes, o Postgres o materializava e o planejador
perdia de vista as datas: margem por categoria em 1 ano foi de 77 ms para 254 ms. Com
`NOT MATERIALIZED`, os relatórios de 1 ano ficaram iguais ou mais rápidos que antes (totais
125 → 41 ms, série mensal 203 → 129 ms, ABC 35 → 38 ms, categoria 77 → 85 ms), e os de 30 dias
um pouco mais lentos (3 → 15 ms). Ficou tudo abaixo de 130 ms, então aceitei o trade-off.

## Permissão
`vendas:devolver` (Gerente e Admin). Devolução é dinheiro saindo; o vendedor chama o gerente.

## Consequências
- `Sale` ganhou `returns` e, por item, `returnedQuantity` e `refundedCents`. O relatório de vendas ganhou `returnsCents`.
- O backup diário confere também que nada foi devolvido além do vendido.
- Ficou para depois: **troca** (devolução + venda nova num passo só) e **vale-troca** (crédito
  para o cliente em vez de dinheiro). Hoje a troca é uma devolução seguida de uma venda.
