import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { RoleKey } from '@mini-erp/contracts';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import { syncAccessCatalog } from '../../src/modules/access/access-catalog.js';
import { hashPassword } from '../../src/modules/access/password/password.js';

export const TEST_PASSWORD = 'senha-de-teste-123';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication<App> = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Zera os dados de negócio e ressincroniza papéis e permissões. */
export async function resetDatabase(prisma: PrismaService) {
  await prisma.$executeRawUnsafe('TRUNCATE users, sessions, user_roles, products, categories, stock_movements, stock_balances, sales, sale_items, sale_payments, sale_returns, sale_return_items, cash_sessions, cash_movements, suppliers, rate_limits CASCADE');
  await syncAccessCatalog(prisma);
}

let passwordHash: Promise<string> | undefined;

export async function createUser(prisma: PrismaService, email: string, roles: RoleKey[]) {
  // Argon2 é lento de propósito: calcula o hash de teste uma vez só.
  passwordHash ??= hashPassword(TEST_PASSWORD);
  return prisma.user.create({
    data: {
      name: email.split('@')[0]!,
      email,
      passwordHash: await passwordHash,
      roles: { create: roles.map((key) => ({ role: { connect: { key } } })) },
    },
  });
}

/** Cliente pagando com uma nota grande: cobre qualquer venda de teste (o troco sai do dinheiro). */
export const PAYS_WITH_PLENTY = [{ method: 'CASH', amountCents: 10_000_000 }] as const;

/** Toda venda exige caixa aberto (D44): os testes abrem o caixa de quem vai vender. */
export async function openCash(agent: TestAgent, openingCents = 0) {
  await agent.post('/api/cash/open').send({ openingCents }).expect(201);
}

/** Agente HTTP que guarda cookies entre requisições, como um navegador. */
export async function loginAs(app: INestApplication<App>, email: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
  return agent;
}
