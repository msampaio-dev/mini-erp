import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL } from './support/config.mjs';
import { login } from './support/helpers.ts';

test.describe('Login e sessão', () => {
  test('senha errada mostra o erro e não entra', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('E-mail').fill(ADMIN_EMAIL);
    await page.getByLabel('Senha').fill('senha-errada-123');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByRole('alert')).toHaveText('E-mail ou senha inválidos');
    await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0);
  });

  test('o formulário valida o e-mail antes de enviar (mesmo schema da API)', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('E-mail').fill('nao-e-email');
    await page.getByLabel('Senha').fill('qualquer');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByRole('alert')).toHaveText('E-mail inválido');
  });

  test('admin entra e cai direto no caixa', async ({ page }) => {
    await login(page);

    await expect(page).toHaveURL(/\/vendas\/nova$/);
    await expect(page.getByRole('heading', { name: 'Nova venda' })).toBeVisible();
  });

  test('a sessão sobrevive ao recarregar e termina ao sair', async ({ page }) => {
    await login(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('cookie de sessão é httpOnly e __Host- (produção)', async ({ page, context }) => {
    await login(page);
    const cookie = (await context.cookies()).find((c) => c.name.endsWith('erp_session'));

    expect(cookie?.name).toBe('__Host-erp_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    // JavaScript da página não enxerga o cookie (proteção contra roubo via XSS).
    expect(await page.evaluate(() => document.cookie)).not.toContain('erp_session');
  });
});
