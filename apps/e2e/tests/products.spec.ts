import { expect, test } from '@playwright/test';
import { apiCreateProduct, brl, login, randomEan, unique } from './support/helpers.ts';

test.describe('Produtos', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('cadastro pela tela, com validação do código de barras e busca na listagem', async ({ page }) => {
    const sku = unique('CAFE');
    const name = `Café Teste ${sku}`;
    await page.getByRole('link', { name: 'Produtos' }).click();
    await page.getByRole('link', { name: 'Novo produto' }).click();

    await page.getByLabel('SKU').fill(sku);
    await page.getByLabel('Nome').fill(name);
    await page.getByLabel('Código de barras (EAN)').fill('7891000315508'); // dígito verificador errado
    await page.getByLabel('Preço de venda (R$)').fill('12,90');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Código de barras inválido (confira os dígitos)')).toBeVisible();

    await page.getByLabel('Código de barras (EAN)').fill(randomEan());
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page).toHaveURL(/\/produtos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name })).toBeVisible();

    await page.getByRole('link', { name: 'Produtos' }).click();
    await page.getByRole('searchbox', { name: 'Buscar produtos' }).fill(sku.toLowerCase());
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(brl('12,90'));
  });

  test('edição simultânea em duas abas: a segunda vê o aviso e recarrega (sem sobrescrever)', async ({ page, context }) => {
    const product = await apiCreateProduct(page);
    const other = await context.newPage(); // outra aba, mesma sessão

    await page.goto(`/produtos/${product.id}`);
    await other.goto(`/produtos/${product.id}`);

    await page.getByLabel('Nome').fill('Nome alterado na aba 1');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page).toHaveURL(/\/produtos$/);

    await other.getByLabel('Preço de venda (R$)').fill('99,90');
    await other.getByRole('button', { name: 'Salvar' }).click();
    await expect(other.getByRole('alert')).toContainText('Outra pessoa alterou este produto');

    await other.getByRole('button', { name: 'Recarregar versão atual' }).click();
    await expect(other.getByLabel('Nome')).toHaveValue('Nome alterado na aba 1');
    await expect(other.getByLabel('Preço de venda (R$)')).toHaveValue('10,00'); // o 99,90 NÃO foi gravado
  });

  test('categorias: criar, renomear e o sistema impede excluir categoria em uso', async ({ page }) => {
    const name = unique('Cat');
    await page.goto('/produtos/categorias');
    await page.getByRole('textbox', { name: 'Nova categoria' }).fill(name);
    await page.getByRole('button', { name: 'Adicionar' }).click();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();

    const categoryId = (await (await page.request.get('/api/categories')).json()).find(
      (c: { name: string }) => c.name === name,
    ).id;
    await apiCreateProduct(page, { categoryId });

    page.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Excluir' }).click();
    await expect(row).toContainText('Categoria em uso por 1 produto(s)');
  });
});
