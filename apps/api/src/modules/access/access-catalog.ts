import { ALL_PERMISSIONS, PERMISSIONS, type Permission, type RoleKey } from '@mini-erp/contracts';
import type { PrismaClient } from '../../generated/prisma/client.js';

type RoleDefinition = { name: string; description: string; permissions: readonly Permission[] };

/**
 * Papéis padrão = combinações de permissões.
 * O código checa PERMISSÕES, nunca papéis: mudar o que um Gerente pode fazer
 * é editar esta tabela (ou o banco), sem tocar em nenhum controller.
 */
export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  ADMIN: {
    name: 'Administrador',
    description: 'Acesso total, incluindo gestão de usuários',
    permissions: ALL_PERMISSIONS,
  },
  GERENTE: {
    name: 'Gerente',
    description: 'Opera e acompanha o negócio, sem gerir usuários',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'usuarios:gerenciar'),
  },
  VENDEDOR: {
    name: 'Vendedor',
    description: 'Opera o caixa: registra e consulta vendas',
    permissions: ['produtos:ler', 'estoque:ler', 'vendas:criar', 'vendas:ler', 'caixa:operar'],
  },
  ESTOQUISTA: {
    name: 'Estoquista',
    description: 'Recebe mercadoria e consulta estoque',
    permissions: ['produtos:ler', 'estoque:ler', 'estoque:entrada', 'fornecedores:ler'],
  },
};

/**
 * Sincroniza permissões e papéis do código com o banco. Idempotente:
 * pode rodar a cada deploy. Usuários e seus vínculos não são tocados.
 */
export async function syncAccessCatalog(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    for (const key of ALL_PERMISSIONS) {
      await tx.permission.upsert({
        where: { key },
        create: { key, description: PERMISSIONS[key] },
        update: { description: PERMISSIONS[key] },
      });
    }

    // Permissões que saíram do catálogo: desvincula e remove.
    const stale = { key: { notIn: ALL_PERMISSIONS } };
    await tx.rolePermission.deleteMany({ where: { permission: stale } });
    await tx.permission.deleteMany({ where: stale });

    const permissionIds = new Map(
      (await tx.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
    );

    for (const [key, def] of Object.entries(ROLE_DEFINITIONS)) {
      const role = await tx.role.upsert({
        where: { key },
        create: { key, name: def.name, description: def.description },
        update: { name: def.name, description: def.description },
      });
      const wanted = def.permissions.map((p) => permissionIds.get(p)!);
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wanted } },
      });
      await tx.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  });
}
