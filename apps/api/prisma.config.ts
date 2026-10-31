import { defineConfig } from 'prisma/config';

// O CLI do Prisma não lê o .env sozinho. Usamos o loader nativo do Node 24
// em vez de adicionar a dependência dotenv. Em CI/produção as variáveis
// vêm do ambiente e o arquivo pode não existir.
try {
  process.loadEnvFile();
} catch {
  // sem .env: segue com process.env
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations pela conexão DIRETA quando houver (Neon: sem '-pooler' no host). O pooler
    // (PgBouncer em modo transação) fica para o tráfego da aplicação (ADR 0015).
    url: process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL'],
  },
});
