import { expect, test } from '@playwright/test';
import { apiCreateProduct, login, unique } from './support/helpers.ts';

test.describe('Fornecedores', () => {
  test('cadastra fornecedor validando o CNPJ e registra uma entrada com fornecedor e nota', async ({ page }) => {
    await login(page);
    const name = `Distribuidora ${unique('F')}`;
    const product = await apiCreateProduct(page);

    await page.getByRole('link', { name: 'Fornecedores' }).click();
    await page.getByRole('button', { name: 'Novo fornecedor' }).click();
    await page.getByLabel('Nome').fill(name);
    // Dígito verificador errado: o formulário recusa antes de enviar (mesmo schema da API).
    await page.getByLabel('CNPJ ou CPF (opcional)').fill('11.222.333/0001-82');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('CNPJ ou CPF inválido')).toBeVisible();
    // CPF de exemplo (válido, não pertence a ninguém): produtor rural pessoa física.
    await page.getByLabel('CNPJ ou CPF (opcional)').fill('529.982.247-25');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('529.982.247-25');

    await page.goto(`/estoque/${product.id}`);
    await page.getByRole('button', { name: 'Registrar entrada' }).first().click();
    const form = page.locator('form', { hasText: 'Registrar entrada' });
    await form.getByLabel('Quantidade (UN)').fill('12');
    await form.getByLabel('Custo unitário (R$)').fill('3,00');
    await form.getByRole('combobox', { name: 'Fornecedor', exact: true }).selectOption({ label: name });
    await form.getByLabel('Nota fiscal do fornecedor').fill('NF 4471');
    await form.getByRole('button', { name: 'Registrar entrada' }).click();

    await expect(page.getByRole('row', { name: /Entrada/ })).toContainText(`${name} · NF 4471`);
  });
});
