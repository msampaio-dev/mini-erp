import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiCreateProduct, apiStockIn, login, unique } from './support/helpers.ts';

test.describe('Permissões e conta', () => {
  test('admin cria um vendedor; o vendedor não vê nem acessa telas gerenciais', async ({ page }) => {
    const email = `${unique('vend').toLowerCase()}@e2e.local`;
    const password = 'senha-vendedor-123';
    await login(page);
    await page.getByRole('link', { name: 'Usuários' }).click();
    await page.getByRole('button', { name: 'Novo usuário' }).click();
    await page.getByLabel('Nome').fill('Vendedora Teste');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha inicial (mín. 10 caracteres)').fill(password);
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    await expect(page.getByRole('row', { name: new RegExp(email) })).toContainText('Vendedor');

    await page.getByRole('button', { name: 'Sair' }).click();
    await login(page, email, password);

    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Caixa' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Usuários' })).toHaveCount(0);
    // Digitar a URL não adianta: a tela recusa (e a API também, ver testes da API).
    await page.goto('/relatorios');
    await expect(page.getByRole('heading', { name: 'Sem permissão' })).toBeVisible();
  });

  test('usuário troca a própria senha e entra com a nova', async ({ page }) => {
    const email = `${unique('troca').toLowerCase()}@e2e.local`;
    await login(page);
    const res = await page.request.post('/api/users', {
      data: { name: 'Troca Senha', email, password: 'senha-inicial-123', roles: ['VENDEDOR'] },
    });
    expect(res.status()).toBe(201);
    await page.getByRole('button', { name: 'Sair' }).click();

    await login(page, email, 'senha-inicial-123');
    await page.getByRole('link', { name: 'Meu acesso' }).click();
    await page.getByLabel('Senha atual').fill('senha-errada-xx');
    await page.getByLabel('Nova senha (mín. 10 caracteres)').fill('senha-nova-456');
    await page.getByLabel('Confirme a nova senha').fill('senha-nova-456');
    await page.getByRole('button', { name: 'Alterar senha' }).click();
    await expect(page.getByText('Senha atual incorreta')).toBeVisible();

    await page.getByLabel('Senha atual').fill('senha-inicial-123');
    await page.getByRole('button', { name: 'Alterar senha' }).click();
    await expect(page.getByRole('status')).toHaveText('Senha alterada.');

    await page.getByRole('button', { name: 'Sair' }).click();
    await login(page, email, 'senha-nova-456');
  });
});

test.describe('Relatórios', () => {
  test('o painel mostra a venda do dia, o gráfico tem tabela equivalente e o CSV baixa', async ({ page }) => {
    await login(page);
    const product = await apiCreateProduct(page, { salePriceCents: 4000 });
    await apiStockIn(page, product.id, 5, 2500);
    const sale = await page.request.post('/api/sales', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { items: [{ productId: product.id, quantity: 1 }], payment: { method: 'PIX' } },
    });
    expect(sale.status()).toBe(201);

    await page.getByRole('link', { name: 'Relatórios' }).click();
    await page.getByRole('button', { name: 'Hoje' }).click();
    await expect(page.locator('.stat', { hasText: 'Receita líquida' })).not.toContainText('R$ 0,00');
    await expect(page.getByRole('img', { name: /Receita líquida por dia/ })).toBeVisible();

    await page.getByText('Ver como tabela').click();
    await expect(page.locator('details table')).toBeVisible();

    const csvHref = await page.locator('a', { hasText: 'Exportar CSV' }).first().getAttribute('href');
    const csv = await page.request.get(csvHref!);
    expect(csv.headers()['content-type']).toContain('text/csv');
  });
});
