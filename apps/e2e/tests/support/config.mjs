// Valores SÓ de teste: existem apenas no banco mini_erp_ui, recriado a cada execução.
export const PORT = 3200;
export const BASE_URL = `http://localhost:${PORT}`;
export const BASE_DB_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://erp:erp@localhost:5433/mini_erp_ui?schema=public';
export const ADMIN_EMAIL = 'admin@e2e.local';
export const ADMIN_PASSWORD = 'senha-e2e-admin-123';
