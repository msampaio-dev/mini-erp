# ADR 0016: Testes de interface com Playwright

- **Status:** aceito
- **Data:** 2026-11-01

## Contexto
Os 176 testes existentes cobrem a API, os contratos e o banco. As telas só eram verificadas por
compilação e tipos: ninguém tinha usado o sistema pelo navegador de forma automatizada. Uma tela
quebrada só seria descoberta por alguém clicando, e o Render publica sozinho a cada push com CI verde.

## Decisão
- **Playwright** num workspace próprio (`apps/e2e`), com Chromium.
- **Mesma configuração do Render:** o `server.mjs` recria um banco só para estes testes
  (`mini_erp_ui`), aplica as migrations e o seed e sobe a **API compilada servindo o React
  compilado** (`WEB_DIST_DIR`), com `NODE_ENV=production` (cookie `__Host-`, CSP). Um teste que
  passa aqui vale para o que está no ar.
- **Seletores por papel e rótulo** (`getByRole`, `getByLabel`), como um leitor de tela enxerga: um
  teste que não acha "o botão Finalizar venda" também aponta um problema de acessibilidade.
- **Cada teste cria os próprios dados** (SKUs únicos), com a preparação pela API e a ação em teste
  pela tela. Rodam em sequência (um banco compartilhado).
- **CI:** job `ui`, após os testes da API. Como o Render só publica com `checksPass`, uma tela
  quebrada **impede o deploy**. Em falha, o CI guarda screenshots e o *trace* por 7 dias (só dados
  do banco de teste).

## Cobertura (15 cenários)
Login (erro, validação, redirecionamento por perfil, sessão ao recarregar e ao sair, cookie
`__Host-`/`httpOnly`/`SameSite`), cadastro de produto com EAN inválido e busca, edição simultânea
em duas abas, categorias, entrada de estoque com custo médio, venda completa no PDV (leitor,
desconto, troco, cancelamento devolvendo estoque), **leitor rápido**, venda acima do estoque,
criação de vendedor e bloqueio de telas gerenciais, troca da própria senha, relatórios (indicadores,
tabela do gráfico, CSV).

## Bug real encontrado
**O PDV perdia itens com leitor de código de barras rápido.** O campo de busca era limpo quando a
resposta da busca chegava; se o operador já estivesse lendo o próximo item, a leitura seguinte era
apagada e o Enter dela encontrava o campo vazio. O *trace* do Playwright mostrou duas leituras e
**uma** única busca na rede. Correção: limpar o campo no momento do Enter (síncrono), guardando o
código lido. O teste "leitor rápido" (4 leituras seguidas sem esperar a tela) passou a cobrir o
caso, e o **teste de mutação** (desfazer a correção) o faz falhar.

## Notas
- `npm audit` acusa 2 alertas *moderate* no `@nestjs/cli` (via `minimatch`), ferramenta só de
  build; a "correção" seria rebaixar para o CLI 11. Produção segue com 0 vulnerabilidades e o CI
  bloqueia *high* em produção (ADR 0013).
- Lição de processo, registrada porque se repetiu nesta sessão: conteúdo com crases (código,
  Markdown) nunca vai em argumento de shell; usar a ferramenta de edição de arquivos.
