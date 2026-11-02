import { expect, test } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';
import { apiBalance, apiCreateProduct, apiEnsureCash, apiStockIn, brl, login, scaleLabel } from './support/helpers.ts';

test.describe('Estoque e vendas', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await apiEnsureCash(page);
  });

  test('entrada de estoque pela tela atualiza saldo e custo médio', async ({ page }) => {
    const product = await apiCreateProduct(page);
    await page.goto(`/estoque/${product.id}`);

    await page.getByRole('button', { name: 'Registrar entrada' }).first().click();
    const form = page.locator('form', { hasText: 'Registrar entrada' });
    await form.getByLabel('Quantidade (UN)').fill('10');
    await form.getByLabel('Custo unitário (R$)').fill('2,00');
    await form.getByRole('button', { name: 'Registrar entrada' }).click();

    await expect(page.locator('.stat', { hasText: 'Saldo atual' })).toContainText('10 UN');
    await expect(page.locator('.stat', { hasText: 'Custo médio' })).toContainText(brl('2,00'));
    await expect(page.getByRole('row', { name: /Entrada/ })).toContainText('+10');
  });

  test('venda no caixa: leitor de código de barras, desconto, troco, e cancelamento devolve o estoque', async ({ page }) => {
    const product = await apiCreateProduct(page, { salePriceCents: 1250 });
    await apiStockIn(page, product.id, 20);
    await page.goto('/vendas/nova');

    // Leitor USB = digita o EAN e aperta Enter. Ler duas vezes soma 1.
    const scanner = page.getByRole('searchbox', { name: 'Adicionar produto' });
    await scanner.fill(product.barcode!);
    await scanner.press('Enter');
    await scanner.fill(product.barcode!);
    await scanner.press('Enter');
    await expect(page.getByLabel(`Quantidade de ${product.name}`)).toHaveValue('2');

    await page.getByRole('combobox').first().selectOption('PERCENT'); // Desconto
    await page.getByLabel('Valor do desconto').fill('10');
    await page.getByLabel('Forma de pagamento 1').selectOption('CASH');
    await page.getByLabel('Valor em Dinheiro').fill('50,00');
    // 2 × 12,50 = 25,00; 10% = 2,50; total 22,50; troco 27,50 (prévia já na tela)
    await expect(page.locator('dd.grand')).toHaveText(brl('22,50'));

    await page.getByRole('button', { name: 'Finalizar venda' }).click();
    await expect(page.getByRole('heading', { name: /Venda nº \d+ registrada/ })).toBeVisible();
    await expect(page.locator('.change')).toContainText(brl('27,50'));
    expect(await apiBalance(page, product.id)).toBe(18);

    await page.getByRole('link', { name: 'Ver venda' }).click();
    await page.getByRole('button', { name: 'Cancelar venda' }).click();
    await page.getByLabel('Motivo').fill('Cliente desistiu');
    await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
    await expect(page.locator('.banner')).toContainText('Cancelada em');
    expect(await apiBalance(page, product.id)).toBe(20);
  });

  test('leitor rápido: 3 produtos lidos em sequência sem esperar a busca, nenhum se perde', async ({ page }) => {
    const products = await Promise.all([1, 2, 3].map(() => apiCreateProduct(page)));
    for (const p of products) await apiStockIn(page, p.id, 5);
    await page.goto('/vendas/nova');

    // Como um operador passando itens no leitor: Enter atrás de Enter, sem esperar a tela.
    const scanner = page.getByRole('searchbox', { name: 'Adicionar produto' });
    for (const p of [...products, products[0]!]) {
      await scanner.pressSequentially(p.barcode!, { delay: 0 });
      await scanner.press('Enter');
    }

    await expect(page.getByLabel(`Quantidade de ${products[0]!.name}`)).toHaveValue('2');
    await expect(page.getByLabel(`Quantidade de ${products[1]!.name}`)).toHaveValue('1');
    await expect(page.getByLabel(`Quantidade de ${products[2]!.name}`)).toHaveValue('1');
  });

  test('venda acima do estoque: o caixa avisa e o servidor recusa sem registrar nada', async ({ page }) => {
    const product = await apiCreateProduct(page);
    await apiStockIn(page, product.id, 1);
    await page.goto('/vendas/nova');

    await page.getByRole('searchbox', { name: 'Adicionar produto' }).fill(product.barcode!);
    await page.getByRole('searchbox', { name: 'Adicionar produto' }).press('Enter');
    await page.getByLabel(`Quantidade de ${product.name}`).fill('5');
    await expect(page.getByText('Saldo disponível: 1')).toBeVisible();

    await page.getByRole('button', { name: 'Finalizar venda' }).click();
    await expect(page.getByRole('alert')).toContainText('Estoque insuficiente');
    await expect(page.getByRole('heading', { name: /Venda nº/ })).toHaveCount(0);
    expect(await apiBalance(page, product.id)).toBe(1);
  });

  test('devolução parcial pela tela: reembolso proporcional, estoque de volta e a venda não pode mais ser cancelada', async ({ page }) => {
    const product = await apiCreateProduct(page, { salePriceCents: 1000 });
    await apiStockIn(page, product.id, 10);
    const res = await page.request.post('/api/sales', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: {
        items: [{ productId: product.id, quantity: 3 }],
        discount: { type: 'PERCENT', percent: 10 },
        payments: [{ method: 'PIX', amountCents: 2700 }],
      },
    });
    expect(res.status()).toBe(201);
    const sale = await res.json();
    expect(await apiBalance(page, product.id)).toBe(7);

    await page.goto(`/vendas/${sale.id}`);
    await page.getByRole('button', { name: 'Registrar devolução' }).click();
    await page.getByLabel(`Devolver de ${product.name}`).fill('1');
    // 1 de 3 unidades de um item de R$ 27,00 líquido (com o desconto) = R$ 9,00.
    await expect(page.getByText('Reembolso:')).toContainText(brl('9,00'));
    await page.getByLabel('Motivo').fill('Embalagem violada');
    await page.getByRole('button', { name: 'Confirmar devolução' }).click();

    await expect(page.getByRole('heading', { name: 'Devoluções' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Embalagem violada' })).toContainText(brl('9,00'));
    await expect(page.getByRole('button', { name: 'Cancelar venda' })).toHaveCount(0);
    expect(await apiBalance(page, product.id)).toBe(8);
  });

  test('etiqueta de balança: o PDV lê o peso da etiqueta e soma duas etiquetas do mesmo produto; cupom sem valor fiscal', async ({
    page,
  }) => {
    const scaleCode = String(randomInt(1, 999_999)).padStart(6, '0');
    const product = await apiCreateProduct(page, { unit: 'KG', salePriceCents: 699, barcode: null, scaleCode });
    await apiStockIn(page, product.id, 20);
    await page.goto('/vendas/nova');

    // Etiquetas de 1,235 kg e 0,500 kg (balança configurada para imprimir o PESO).
    const scanner = page.getByRole('searchbox', { name: 'Adicionar produto' });
    for (const grams of ['01235', '00500']) {
      await scanner.fill(scaleLabel(`2${scaleCode}${grams}`));
      await scanner.press('Enter');
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await expect(page.getByLabel(`Quantidade de ${product.name}`)).toHaveValue('1,735');
    // 1,735 kg × R$ 6,99 = R$ 12,13 (12,12765 arredondado)
    await expect(page.locator('dd.grand')).toHaveText(brl('12,13'));

    await page.getByRole('button', { name: 'Finalizar venda' }).click();
    await expect(page.getByRole('heading', { name: /Venda nº \d+ registrada/ })).toBeVisible();
    await page.getByRole('link', { name: 'Ver venda' }).click();
    await page.getByRole('link', { name: 'Cupom' }).click();

    const cupom = page.getByRole('article', { name: /Cupom da venda/ });
    await expect(cupom).toContainText('DOCUMENTO SEM VALOR FISCAL');
    await expect(cupom).toContainText(product.name);
    await expect(cupom).toContainText(/1,735 KG × R\$\s6,99/);
  });
});
