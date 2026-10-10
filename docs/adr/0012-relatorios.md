# ADR 0012: Relatórios

- **Status:** aceito
- **Data:** 2026-10-10

## D30: leitura direta, CQRS simplificado
O módulo `Reports` só lê. Consulta as tabelas transacionais com SQL agregado
(`apps/api/src/modules/reports/reports.queries.ts`), sem data warehouse nem banco separado.
Cada consulta é um `Prisma.sql` parametrizado e montado sem executar: o mesmo objeto serve ao
serviço e ao script de medição.

**Quando evoluir:** se os relatórios começarem a disputar recursos com o caixa (vendas lentas
durante consultas pesadas), o primeiro passo é uma **réplica de leitura** do Postgres; depois,
*materialized views* atualizadas periodicamente para as agregações anuais.

## D31: relatórios
Vendas por período (totais + série por dia/semana/mês), margem por produto/categoria (receita
menos o custo fotografado na venda), curva ABC, valor do estoque, reposição, produtos parados e
desempenho por vendedor. Todos exigem `relatorios:ler`. Canceladas não entram na receita.

Curva ABC: classe pelo acumulado **antes** do item (A < 80%, B < 95%, C o resto): o produto que
"cruza" os 80% ainda é A. O acumulado vem de uma *window function* (`sum() OVER (ORDER BY ...)`).

## D32: fuso horário
O dia de uma venda é o dia em **America/Sao_Paulo** (`created_at AT TIME ZONE ...`). A série usa
`generate_series` para que dias sem venda apareçam com zero.

**Teste de mutação:** o teste de fuso foi validado trocando o fuso por `UTC` de propósito. Na
primeira versão ele **continuou passando**: as duas vendas de borda tinham valores idênticos, e o
agrupamento errado trocava uma pela outra sem alterar o total. Com valores distintos, 6 testes
falham sob a mutação e todos passam com o código correto.

## D33: intervalo semiaberto
O usuário escolhe datas inclusivas; a API usa `[início 00:00, fim + 1 dia 00:00)` em São Paulo.
Nunca `<= 23:59:59`. Há teste com venda às 23:59:59.999.

## D34: CSV para o Excel brasileiro
`?format=csv`: separador `;`, vírgula decimal, BOM UTF-8, CRLF, nome de arquivo com o período.
**Injeção de fórmula (OWASP):** textos que começam com `= + - @` (ou tab/CR) recebem `'` na frente,
senão um produto chamado `=HYPERLINK(...)` viraria um link ativo na planilha. Números negativos
continuam números.

## D35: desempenho medido
`npm run perf:reports -w @mini-erp/api` cria um banco separado (`<banco>_perf`), gera
**50.000 vendas / 150.000 itens / 500 produtos** em ~20 s via SQL e roda cada consulta com
`EXPLAIN (ANALYZE, BUFFERS)` (mediana de 5 execuções):

| Consulta | Tempo |
|---|---|
| Totais / série diária (30 dias) | 19 / 24 ms |
| Totais / série mensal (1 ano) | 138 / 230 ms |
| Margem por produto (30 dias) | 27 ms |
| Margem por categoria / Curva ABC / Vendedores (1 ano) | 107 / 62 / 16 ms |
| Valor do estoque / Reposição | < 1 ms |
| Produtos parados | **2.635 ms → 53 ms** |

A única consulta fora da curva era "produtos parados": um `LEFT JOIN LATERAL` fazia o planejador
varrer `sales` **uma vez por produto**. Reescrita como um único `GROUP BY` cruzado depois, ficou
~50× mais rápida, **sem índice novo**, e os testes confirmaram o mesmo resultado. Nenhum índice
foi adicionado: os existentes (`sales.created_at`, `sale_items(sale_id, …)`) já atendem, e as
consultas anuais (≤ 230 ms) são aceitáveis para uma tela gerencial.

## D36: painel
Filtros de período numa linha (atalhos + datas, refletidos na URL), indicadores no topo, gráfico
de colunas da receita (SVG próprio, série única validada contra as superfícies clara e escura,
tooltip por mouse e teclado, tabela equivalente em "Ver como tabela") e tabelas de ABC, margem,
vendedores, reposição e parados, cada uma com "Exportar CSV".

O gráfico é desenhado no **tamanho real em pixels** (medido com `ResizeObserver`), não escalado
por `viewBox`: na primeira versão, num celular de 375px o texto dos eixos encolheria para ~4px.
Só rola na horizontal quando não cabe (menos de 6px por coluna) e abre rolado no período mais recente.
