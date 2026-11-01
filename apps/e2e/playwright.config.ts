import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './tests/support/config.mjs';

/**
 * Testes de interface (ADR 0016): o navegador usa o sistema como uma pessoa usaria, contra a
 * MESMA configuração do Render (API compilada servindo o React compilado). Rodar:
 *   npm run build && npm test -w @mini-erp/e2e
 */
export default defineConfig({
  testDir: './tests',
  // Um banco compartilhado: arquivos em sequência. Cada teste cria os próprios dados (SKUs únicos).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // Em caso de falha: rastro completo (cliques, rede, DOM) para investigar.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node server.mjs',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
