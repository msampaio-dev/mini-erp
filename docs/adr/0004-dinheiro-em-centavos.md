# ADR 0004: Dinheiro em centavos (inteiro)

- **Status:** aceito
- **Data:** 2026-10-05

## Contexto
Ponto flutuante não representa decimais com exatidão: `0.1 + 0.2 === 0.30000000000000004`.
Somado em milhares de vendas, isso vira diferença de caixa.

## Decisão
Preços e totais trafegam e são armazenados como **inteiros em centavos**
(`centsSchema` em `@mini-erp/contracts`). A conversão para reais acontece só na
exibição (`formatCents`).

## Consequências
- A aritmética é exata e as comparações são triviais.
- Desconto percentual exige uma regra de arredondamento explícita (será definida na Fase 5).
