# ADR 0009: Catálogo de produtos

- **Status:** aceito
- **Data:** 2026-10-05

## Decisões

### Identidade: UUID técnico + SKU de negócio
O `id` (UUID v7) é a chave primária e a referência usada por estoque e vendas; nunca muda.
O `sku` é o código que as pessoas usam: único, normalizado em maiúsculas (contrato + `CHECK`),
e **editável**. Trocar o padrão de códigos não quebra nenhum histórico.

### Arquivar em vez de apagar
Produtos têm `status` `ACTIVE`/`ARCHIVED`. O arquivado some das listagens padrão, mas continua
consultável e referenciável. Não existe DELETE de produto na API.

### Optimistic locking
Cada produto tem `version`. A edição (`PUT`, substituição completa) envia a versão que o usuário
viu; a API faz `UPDATE ... WHERE id = $1 AND version = $2` com `version = version + 1`.
Zero linhas afetadas = alguém alterou antes → **409 com `code: VERSION_CONFLICT`**.
O teste e2e dispara 5 edições simultâneas com a mesma versão: exatamente uma vence.

Escolhido em vez de *lock* pessimista porque conflitos de edição de cadastro são raros e um lock
seguraria a linha enquanto alguém "pensa" com o formulário aberto.

### Produto não guarda saldo
Preço de venda (centavos, ADR 0004) e estoque mínimo ficam no produto; o saldo pertence ao módulo
de Estoque (ADR 0002). O custo virá das entradas (Fase 4).

### Unidade de medida e quantidades fracionadas
Unidades `UN, CX, PC, KG, L, M`. Apenas `KG, L, M` aceitam frações (até 3 casas decimais,
`DECIMAL(14,3)` no banco). A regra vale para o estoque mínimo já agora e guiará as movimentações.

### Código de barras
Opcional, único (o Postgres aceita vários `NULL` num índice único), com validação do dígito
verificador GTIN (EAN-8/UPC-12/EAN-13/GTIN-14) no contrato e formato garantido por `CHECK`.

### Categorias
Tabela própria; nome único **sem diferenciar maiúsculas** via tipo `citext`.

### Busca e paginação
Busca parcial por nome/SKU (`ILIKE '%termo%'`) acelerada por índices **GIN `pg_trgm`**
(verificado com `EXPLAIN`: `Bitmap Index Scan on products_name_trgm_idx`). Paginação por
número de página com ordenação estável (`name, id`); contagem e página na mesma transação.

### Front: React Router + TanStack Query
URLs reais (`/produtos/:id`), filtros e página na query string. TanStack Query cuida de cache,
estados de carregamento e invalidação após escrita; 401 em qualquer requisição volta ao login;
o cache é limpo ao sair (dados de um usuário nunca aparecem para o próximo).

## Notas de implementação
- Extensões `citext`/`pg_trgm` e os `CHECK` são escritos à mão na migration (o Prisma não os gera).
  Fluxo: `prisma migrate dev --create-only` → revisar/completar o SQL → aplicar.
- Com o adapter `pg`, o erro P2002 informa o **nome do índice** (`products_barcode_key`), não os
  campos. `uniqueViolationTarget` cobre os dois formatos; um teste e2e garante a mensagem certa.
- O front de dev usa a porta fixa **5180** com `strictPort`: a 5173 é usada por outro projeto na
  máquina de desenvolvimento.
