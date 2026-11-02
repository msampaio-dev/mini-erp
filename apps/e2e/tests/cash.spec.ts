import { expect, test } from '@playwright/test';
import { apiCreateProduct, apiStockIn, brl, login, unique } from './support/helpers.ts';

test.describe('Caixa', () => {
  test('vendedor abre o caixa, vende com pagamento dividido, faz sangria e fecha às cegas', async ({ page }) => {
    // Preparação como admin: produto com estoque e um vendedor novo (caixa próprio, sem caixa:gerenciar).
    await login(page);
    const product = await apiCreateProduct(page, { salePriceCents: 1250 });
    await apiStockIn(page, product.id, 10);
    const email = `${unique('caixa').toLowerCase()}@e2e.local`;
    const created = await page.request.post('/api/users', {
      data: { name: 'Operadora Caixa', email, password: 'senha-operadora-123', roles: ['VENDEDOR'] },
    });
    expect(created.status()).toBe(201);
    await page.getByRole('button', { name: 'Sair' }).click();
    await login(page, email, 'senha-operadora-123');

    // Sem caixa aberto o PDV não vende.
    await page.goto('/vendas/nova');
    await expect(page.getByRole('heading', { name: 'Caixa fechado' })).toBeVisible();
    await page.getByRole('link', { name: 'Abrir caixa' }).click();
    await page.getByLabel('Troco inicial (R$)').fill('100,00');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await page.getByRole('link', { name: 'Ir para o PDV' }).click();

    // 2 × R$ 12,50 = R$ 25,00: R$ 10,00 no Pix + nota de R$ 20,00 → troco R$ 5,00.
    const scanner = page.getByRole('searchbox', { name: 'Adicionar produto' });
    await scanner.fill(product.barcode!);
    await scanner.press('Enter');
    await page.getByLabel(`Quantidade de ${product.name}`).fill('2');
    await page.getByLabel('Valor em Pix').fill('10,00');
    await page.getByRole('button', { name: 'Dividir pagamento' }).click();
    await page.getByLabel('Forma de pagamento 2').selectOption('CASH');
    await page.getByLabel('Valor em Dinheiro').fill('20,00');
    await page.getByRole('button', { name: 'Finalizar venda' }).click();
    await expect(page.getByRole('heading', { name: /Venda nº \d+ registrada/ })).toBeVisible();
    await expect(page.getByText('Dinheiro + Pix')).toBeVisible();
    await expect(page.locator('.change')).toContainText(brl('5,00'));

    // Fechamento cego: o operador não vê o esperado com o caixa aberto.
    await page.getByRole('navigation').first().getByRole('link', { name: 'Caixa' }).click();
    await expect(page.getByText('1 venda(s)')).toBeVisible();
    await expect(page.getByText('Esperado em dinheiro')).toHaveCount(0);

    await page.getByLabel('Valor (R$)').fill('50,00');
    await page.getByLabel('Motivo').fill('Depósito no cofre');
    await page.getByRole('button', { name: 'Registrar' }).click();
    await expect(page.getByRole('status')).toContainText(brl('50,00'));

    // Esperado: 100 de troco + 15 da venda em dinheiro − 50 da sangria = R$ 65,00.
    await page.getByLabel('Dinheiro contado (R$)').fill('65,00');
    await page.getByRole('button', { name: 'Fechar caixa' }).click();
    await page.getByRole('button', { name: 'Confirmar fechamento' }).click();
    await expect(page.getByText(/Caixa nº \d+ fechado/)).toBeVisible();
    await expect(page.locator('dd', { hasText: brl('65,00') }).first()).toBeVisible();
    await expect(page.locator('dt.grand')).toHaveText('Diferença');
  });
});
