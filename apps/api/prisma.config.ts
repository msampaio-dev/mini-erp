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
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
