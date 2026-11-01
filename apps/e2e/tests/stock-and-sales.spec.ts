import { expect, test } from '@playwright/test';
import { apiBalance, apiCreateProduct, apiStockIn, brl, login } from './support/helpers.ts';

test.describe('Estoque e vendas', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
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
    await page.getByLabel('Pagamento').selectOption('CASH');
    await page.getByLabel('Valor recebido (R$)').fill('50,00');
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
});
