/**
 * Seed idempotente: pode rodar quantas vezes quiser (npm run db:seed).
 * 1. Sincroniza permissões e papéis do código com o banco.
 * 2. Cria o primeiro administrador a partir de SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 *    Se ele já existir, a senha NÃO é alterada: o seed nunca sobrescreve dados de quem usa o sistema.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { createUserSchema } from '@mini-erp/contracts';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { syncAccessCatalog } from '../src/modules/access/access-catalog.js';
import { hashPassword } from '../src/modules/access/password/password.js';

try {
  process.loadEnvFile();
} catch {
  // sem .env: usa process.env
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL']! }),
});

async function seedAdmin() {
  const email = process.env['SEED_ADMIN_EMAIL'];
  const password = process.env['SEED_ADMIN_PASSWORD'];
  if (!email || !password) {
    console.warn('SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD ausentes: administrador não criado.');
    return;
  }

  // Reaproveita o contrato: o admin do seed obedece à mesma política de senha.
  const input = createUserSchema.parse({ name: 'Administrador', email, password, roles: ['ADMIN'] });
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    console.log(`Administrador ${input.email} já existe: mantido como está.`);
    return;
  }

  await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      roles: { create: { role: { connect: { key: 'ADMIN' } } } },
    },
  });
  console.log(`Administrador ${input.email} criado.`);
}

try {
  await syncAccessCatalog(prisma);
  console.log('Permissões e papéis sincronizados.');
  await seedAdmin();
} finally {
  await prisma.$disconnect();
}
