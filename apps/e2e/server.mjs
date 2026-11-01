// Servidor para os testes de interface (Playwright): mesma configuração do Render (ADR 0015).
// 1. Recria um banco SÓ para estes testes (mini_erp_ui).
// 2. Aplica as migrations e o seed (admin de teste).
// 3. Sobe a API compilada servindo também o React compilado, na mesma origem.
//
// Pré-requisito: `npm run build` na raiz (API e front compilados).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_DB_URL, PORT } from './tests/support/config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const api = resolve(root, 'apps/api');
const webDist = resolve(root, 'apps/web/dist');
for (const path of [resolve(api, 'dist/main.js'), resolve(webDist, 'index.html')]) {
  if (!existsSync(path)) {
    console.error(`Falta ${path}. Rode "npm run build" na raiz antes dos testes de interface.`);
    process.exit(1);
  }
}

const url = new URL(BASE_DB_URL);
const dbName = url.pathname.slice(1);
const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await client.query(`CREATE DATABASE "${dbName}"`);
await client.end();

const env = {
  ...process.env,
  NODE_ENV: 'production', // cookie __Host-, CSP, logs JSON: como em produção
  DATABASE_URL: url.toString(),
  PORT: String(PORT),
  WEB_DIST_DIR: webDist,
  TRUST_PROXY: '0',
  LOGIN_RATE_LIMIT: '1000', // os testes fazem muitos logins a partir do mesmo IP
  SEED_ADMIN_EMAIL: ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
};
const run = (cmd) => {
  const r = spawnSync(cmd, { cwd: api, env, shell: true, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('npx prisma migrate deploy');
run('npx prisma db seed');

const server = spawn(process.execPath, ['dist/main.js'], { cwd: api, env, stdio: 'inherit' });
const stop = () => server.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));
