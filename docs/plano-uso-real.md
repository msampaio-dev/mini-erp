# Plano: do portfólio ao uso real

O sistema já controla estoque e vendas de forma correta e segura. Para um comércio usar no dia a
dia, faltam três blocos: **fiscal**, **operação de loja** e **infraestrutura paga**. Este documento
registra as decisões propostas e o que depende de dados do negócio (seção final).

## 1. Fiscal (NFC-e): obrigatório para vender ao consumidor

No varejo, cada venda ao consumidor final precisa de um documento fiscal eletrônico: a **NFC-e**
(modelo 65), autorizada pela SEFAZ do estado. Sem isso, o sistema serve só como controle interno.

### Pré-requisitos (do negócio, não do código)
- CNPJ com **Inscrição Estadual** ativa e **credenciamento para NFC-e** na SEFAZ do estado.
- **CSC** (Código de Segurança do Contribuinte), gerado no portal da SEFAZ, para o QR Code.
- **Certificado digital A1** (e-CNPJ, arquivo .pfx, validade de 1 ano).
- **Contador** para validar a tributação de cada produto. Esta parte não se chuta.

### Decisão F1: emitir por um integrador, não direto na SEFAZ (proposta)
| | Integrador (Focus NFe, PlugNotas, Nuvem Fiscal...) | Direto na SEFAZ |
|---|---|---|
| Esforço | uma API REST com JSON | XML assinado, SOAP, schemas e particularidades de cada estado |
| Mudanças de layout (reforma tributária: IBS/CBS) | o integrador atualiza | nós atualizamos, com prazo da SEFAZ |
| Custo | mensalidade ou valor por nota | zero em dinheiro, alto em manutenção |
| Risco | depende de um fornecedor | erro nosso = venda sem nota |

Para um sistema mantido por uma pessoa, o integrador é a escolha responsável. A integração fica
atrás de uma interface (`FiscalProvider`), então trocar de fornecedor não mexe nas vendas.

### Decisão F2: emissão assíncrona com outbox (proposta)
A SEFAZ cai, demora e rejeita. A venda **não pode** depender dela para concluir:

1. Na **mesma transação** da venda, gravamos `fiscal_documents` com status `PENDENTE`
   (padrão *transactional outbox*: venda e pedido de nota nunca se separam).
2. Um worker envia ao integrador e atualiza para `AUTORIZADA` ou `REJEITADA`, com tentativas e
   espera crescente entre elas.
3. SEFAZ fora do ar: emissão em **contingência offline** (prevista na legislação), transmitida
   depois.
4. Cancelamento da venda dentro do prazo legal do estado vira **cancelamento da NFC-e**; fora do
   prazo, só por devolução.
5. XML autorizado guardado por **5 anos** (exigência fiscal), fora do banco principal.

### Mudanças no cadastro
Cada produto precisa de: **NCM**, **CEST** (quando houver), **CFOP**, **CST/CSOSN**, origem e
alíquotas. O EAN que já temos vai na nota. Isso entra como migration nova com validação Zod, e
o PDV bloqueia a venda de produto sem dados fiscais.

## 2. Operação de loja

Em ordem de prioridade para um mercado:

1. ✅ **Caixa** (ADR 0018): abertura com troco, sangria, suprimento e fechamento com conferência (esperado ×
   contado). Toda venda pertence a uma sessão de caixa. Sem isso, a diferença no fim do dia não
   tem explicação.
2. ✅ **Formas de pagamento** (ADR 0018): dinheiro (com troco), PIX e cartão, inclusive pagamento dividido.
   Primeiro registramos o que a maquininha aprovou; integração TEF fica para depois.
3. ✅ **Devolução parcial** (ADR 0019; a troca é devolução + venda nova): hoje só existe cancelamento da venda inteira. A devolução
   gera entrada no livro-razão, como o estorno já faz.
4. ✅ **Impressão do cupom** (ADR 0020) em impressora térmica de 80 mm (página de impressão do navegador, sem
   driver especial).
5. ✅ **Produtos pesáveis** (ADR 0020): etiqueta de balança (EAN-13 começando com 2, com peso ou preço dentro
   do código). A unidade fracionada (KG) já existe no estoque.
6. **Fornecedores e pedidos de compra:** a entrada de estoque passa a referenciar o pedido.
7. **Clientes** (opcional): CPF na nota. Isso traz obrigações da **LGPD** (finalidade, retenção,
   acesso restrito).

## 3. Infraestrutura

O plano gratuito atual tem dois limites que não servem para loja aberta:
- **Render free hiberna:** a primeira venda depois de 15 minutos parados espera cerca de 1 minuto.
- **Neon free** suspende o banco ocioso e tem limite de horas de computação no mês.

Proposta: Render **Starter** (sem hibernação) + Neon **Launch**, na faixa de US$ 25 a 35 por mês
somados (conferir os preços na hora). Alternativa: uma VPS com a stack Docker que já existe
(`docs/deploy.md`), mais barata, mas aí a manutenção do servidor é nossa. Em qualquer opção:
monitoramento de disponibilidade com alerta e o backup diário (ADR 0017), que já está pronto.

**Internet da loja:** se cair, o PDV para. Mitigação simples: roteador com chip 4G de reserva. A
alternativa, um PDV que funciona offline, é um projeto grande (sincronização e conflitos de
estoque) e só se justifica com quedas frequentes.

## Ordem sugerida
1. Infraestrutura paga (rápido, elimina a hibernação)
2. Caixa + formas de pagamento
3. Dados fiscais no produto + NFC-e via integrador (homologação primeiro, depois produção)
4. Devolução parcial e cupom impresso
5. Pesáveis, fornecedores e clientes, conforme a necessidade

## Perguntas para o dono do negócio
1. Existe um comércio real para usar? Qual o **ramo**, o **estado** e o **município**?
2. Qual o **regime tributário** (Simples Nacional, Lucro Presumido, Real)? Tem **contador**?
3. Já tem **certificado A1** e **credenciamento de NFC-e**? Hoje emite nota com outro sistema?
4. Quantos **caixas** ao mesmo tempo? Quantas vendas num dia movimentado?
5. Quais **formas de pagamento**? Qual maquininha?
6. Tem **impressora térmica** e **balança** com etiqueta?
7. A internet da loja costuma cair?
8. Qual o orçamento mensal para hospedagem e integrador fiscal?
