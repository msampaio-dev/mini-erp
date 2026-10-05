# ADR 0002: Estoque como livro-razão (ledger)

- **Status:** aceito (implementação na Fase 4)
- **Data:** 2026-10-05

## Contexto
Um ERP precisa responder "por que o saldo é este?". Um campo `produto.quantidade` alterado
por UPDATE perde o histórico: não se sabe quem mexeu, quando nem por quê.

## Decisão
- O estoque é uma sequência **imutável** de movimentações (`ENTRADA`, `SAIDA`, `AJUSTE`),
  cada uma com quantidade, motivo, usuário e data.
- Erros são corrigidos com uma **movimentação de estorno**, nunca com UPDATE ou DELETE.
- Uma tabela de saldo é atualizada **na mesma transação** da movimentação (cache consistente).
  A fonte da verdade continua sendo o ledger.
- Baixa concorrente via UPDATE atômico condicional (`... WHERE qtd >= :n`) e
  `CHECK (qtd >= 0)` no banco como última linha de defesa.

## Consequências
- Auditoria completa e saldo reconstituível em qualquer data passada.
- Relatórios (giro, curva ABC) saem direto do ledger.
- Mais linhas no banco; mitigado pela tabela de saldo e por índices.
