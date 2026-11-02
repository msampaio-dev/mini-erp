# ADR 0021: Fornecedores na entrada de estoque

- **Status:** aceito
- **Data:** 2026-11-02
- **Parte de:** plano de uso real (`docs/plano-uso-real.md`, seção 2)

## Contexto
A entrada de estoque guardava fornecedor e nota fiscal num campo de texto livre ("Observação").
Isso impede perguntas simples: o que compramos da Distribuidora X? Qual nota trouxe este lote?

## Decisões

### D57. Cadastro de fornecedores, com CNPJ **ou** CPF
- Nome, CNPJ/CPF (opcional), telefone, e-mail e observação. CPF também vale: produtor rural e
  feirante costumam vender como pessoa física.
- O documento é guardado **só com dígitos** e validado pelos **dígitos verificadores**, no front
  e na API pelo mesmo schema. É único quando informado, e uma CHECK no banco garante o formato.
- **Desativar, nunca apagar**, como produtos e usuários: as entradas antigas continuam mostrando
  de onde veio a mercadoria. Fornecedor desativado não aparece para novas entradas, e a API
  recusa usá-lo (409).

### D58. A entrada aponta para o fornecedor e para a nota
- `stock_movements` ganhou `supplier_id` e `invoice_number`, opcionais (nem toda entrada tem
  fornecedor) e permitidos **só em ENTRADA**, por CHECK no banco. O livro-razão continua
  imutável: as colunas novas são preenchidas no INSERT e nunca alteradas.
- O kardex mostra fornecedor e nota na coluna de observação.
- O Estoque confere o fornecedor pela interface pública do módulo de Fornecedores (ADR 0001),
  sem consultar a tabela dele.

### D59. Permissões
- `fornecedores:ler` para o Estoquista: precisa escolher o fornecedor ao dar entrada.
- `fornecedores:gerenciar` para Gerente e Admin.

## Fora do escopo (e por quê)
- **Pedido de compra** (pedido → recebimento → conferência de divergências) é um fluxo inteiro.
  Só compensa com compras recorrentes planejadas. A entrada com fornecedor e nota já responde
  "o que veio de quem".
- **Cadastro de clientes** só faz sentido junto com a NFC-e ("CPF na nota") e traz obrigações
  da LGPD (finalidade, retenção, acesso). Fica para a fase fiscal.
- **Seletor de fornecedor** carrega os 100 primeiros ativos. Serve para um mercado (dezenas de
  fornecedores). Com centenas, vira campo de busca.
