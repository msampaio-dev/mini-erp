/**
 * Os testes e2e rodam num banco próprio (<banco>_test), derivado do DATABASE_URL do .env.
 * Assim, limpar tabelas entre testes nunca apaga os dados de desenvolvimento.
 */
export function testDatabaseUrl(): string {
  try {
    process.loadEnvFile();
  } catch {
    // sem .env: usa process.env (CI)
  }
  const base = process.env['DATABASE_URL'];
  if (!base) throw new Error('DATABASE_URL não definido');

  const url = new URL(base);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test')) url.pathname = `/${dbName}_test`;
  return url.toString();
}
