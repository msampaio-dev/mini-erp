import { expect, type Page } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './config.mjs';

/** Entra pela TELA de login (não pela API): o próprio login também é testado em cada uso. */
export async function login(page: Page, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
}

/** Sufixo único: cada teste cria os próprios dados e não depende da ordem de execução. */
export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}${randomInt(1000)}`;

/** EAN-13 de uso interno (prefixo 2) com dígito verificador válido. */
export function randomEan(): string {
  const body = `2${String(randomInt(10 ** 11)).padStart(11, '0')}`;
  const sum = [...body].reverse().reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

/** Valor em reais como o Intl formata (o espaço após "R$" é um NBSP: \s cobre os dois). */
export const brl = (text: string) => new RegExp(`R\\$\\s${text.replace('.', '\\.')}`);

// ─── Preparação de dados pela API (com a sessão da página) ────────────────────
// O que NÃO é o foco do teste é criado pela API, para o teste ser rápido e preciso.

export type Product = { id: string; sku: string; name: string; barcode: string | null };

export async function apiCreateProduct(page: Page, data: Record<string, unknown> = {}): Promise<Product> {
  const sku = unique('E2E');
  const res = await page.request.post('/api/products', {
    data: { sku, name: `Produto ${sku}`, unit: 'UN', salePriceCents: 1000, barcode: randomEan(), ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

export async function apiStockIn(page: Page, productId: string, quantity: number, unitCostCents = 500) {
  const res = await page.request.post('/api/inventory/entries', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { productId, quantity, unitCostCents },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** Toda venda exige caixa aberto (ADR 0018). O admin dos testes mantém um caixa aberto entre os testes. */
export async function apiEnsureCash(page: Page) {
  const current = await page.request.get('/api/cash/current');
  if ((await current.json()).session) return;
  const res = await page.request.post('/api/cash/open', { data: { openingCents: 0 } });
  expect(res.status(), await res.text()).toBe(201);
}

export async function apiBalance(page: Page, productId: string): Promise<number> {
  const res = await page.request.get(`/api/inventory/balances?productIds=${productId}`);
  return (await res.json())[0].quantity;
}
