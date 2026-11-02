# ADR 0020: Cupom impresso e etiqueta de balança

- **Status:** aceito
- **Data:** 2026-11-02
- **Parte de:** plano de uso real (`docs/plano-uso-real.md`, seção 2)

## Contexto
Dois hábitos de qualquer mercado: entregar o comprovante ao cliente e vender hortifrúti, carne
e frios pesados na balança, com a etiqueta lida no caixa.

## Decisões

### D55. Cupom pela impressão do navegador, "sem valor fiscal"
- Tela `/vendas/:id/cupom` com CSS de impressão: 72 mm de área útil (bobina de 80 mm), fonte
  monoespaçada, sem menus. O PDV tem o atalho "Imprimir cupom", que abre a janela de impressão
  sozinho. **Não exige driver especial nem programa instalado:** qualquer térmica que o sistema
  operacional reconheça como impressora funciona.
- **Tamanho da página:** `@page { size: 80mm 297mm }`, que é o papel "bobina 80 × 297 mm" dos
  drivers de térmica (Epson, Elgin, Bematech), e o driver corta no fim do conteúdo. A primeira
  versão usava `80mm auto`, que é **CSS inválido** (`auto` só vale sozinho): o navegador
  ignorava a regra em silêncio, e só a geração do PDF mostrou o problema. A regra é injetada
  apenas enquanto a tela do cupom está aberta; as outras telas continuam imprimindo em A4.
- O cupom diz **"DOCUMENTO SEM VALOR FISCAL"**. Até existir a NFC-e (seção 1 do plano), ele
  não pode parecer um documento fiscal.
- Nome, CNPJ e endereço da loja vêm de variáveis de ambiente (`STORE_NAME`, `STORE_DOCUMENT`,
  `STORE_ADDRESS`) e são lidos em `GET /api/store/settings`. Mudam por loja, não por usuário, e
  não justificam uma tela de configuração agora.
- Não usamos ESC/POS direto (comandos da impressora, gaveta, guilhotina): exigiria um programa
  local ou WebUSB. Fica para quando a gaveta automática for pedida.

### D56. Etiqueta de balança: `2 CCCCCC VVVVV D`
- EAN-13 de uso interno: prefixo 2, **código do produto na balança** (6 dígitos), **valor**
  (5 dígitos) e dígito verificador. O produto ganhou o campo `scaleCode`: único, só para KG,
  guardado com zeros à esquerda (CHECK no banco).
- O valor pode ser o **peso em gramas** ou o **preço total**, conforme a configuração da balança.
  O sistema precisa saber qual (`SCALE_LABEL_MODE`), porque ler peso como preço erraria a
  quantidade. **Recomendado: peso (`WEIGHT`)**, que dá a quantidade exata e a mesma conta de
  preço do resto do sistema. No modo preço, a quantidade é preço ÷ preço por kg (3 casas), e o
  total recalculado pode diferir da etiqueta em 1 centavo.
- No PDV, o código lido é primeiro procurado como código de barras comum; só se não existir é
  interpretado como etiqueta. Assim, produtos da loja com EAN interno começando com 2 continuam
  funcionando. Duas etiquetas do mesmo produto viram uma linha com o peso somado, em milésimos
  inteiros (0,1 + 0,2 em float daria 0,30000000000000004).
- `parseScaleLabel` e `scaleQuantity` ficam em `@mini-erp/contracts`, com testes unitários.

## Consequências
- Para usar: cadastrar o código da balança nos produtos pesáveis, configurar a balança para o
  formato `2 + código(6) + peso(5)` e definir `SCALE_LABEL_MODE` se ela imprimir preço.
- Formatos de balança diferentes (código com 4 ou 5 dígitos) exigem ajustar `parseScaleLabel`.
  Os mais comuns no Brasil permitem configurar 6.
