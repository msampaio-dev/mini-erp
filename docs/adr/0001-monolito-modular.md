# ADR 0001: Monólito modular

- **Status:** aceito
- **Data:** 2026-10-05

## Contexto
O sistema tem cinco contextos de negócio (Catálogo, Estoque, Vendas, Acesso, Relatórios).
Uma venda precisa baixar o estoque de forma **atômica**: ou as duas coisas acontecem, ou nenhuma.
O time é de uma pessoa.

## Decisão
Um único deployável (NestJS) com **um módulo por contexto**. Cada módulo expõe apenas o seu
service público; nenhum módulo acessa as tabelas de outro diretamente.

## Alternativas consideradas
- **Microsserviços:** a atomicidade venda/estoque exigiria Saga, mensageria e compensações.
  Microsserviços resolvem escala de *times*, problema que não temos.
- **Monólito sem fronteiras:** é rápido no início, mas vira acoplamento total com o tempo.

## Consequências
- Transações ACID simples entre módulos (uma conexão, um banco).
- Um deploy só, um banco só: operação barata.
- Exige disciplina nas fronteiras. Se um módulo precisar escalar sozinho, a extração é viável
  porque a interface já existe.
