import { isPermission, type Me, type Permission } from '@mini-erp/contracts';

/** Quem está fazendo a requisição. Montado pelo AccessGuard a cada request. */
export interface AuthContext {
  sessionId: string;
  user: { id: string; name: string; email: string };
  roles: string[];
  permissions: ReadonlySet<Permission>;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** Formato do usuário carregado com papéis e permissões (ver SessionService). */
export interface UserWithAccess {
  id: string;
  name: string;
  email: string;
  roles: { role: { key: string; permissions: { permission: { key: string } }[] } }[];
}

export const userWithAccessSelect = {
  id: true,
  name: true,
  email: true,
  roles: {
    select: {
      role: {
        select: { key: true, permissions: { select: { permission: { select: { key: true } } } } },
      },
    },
  },
} as const;

export function buildAuthContext(sessionId: string, user: UserWithAccess): AuthContext {
  const permissions = new Set<Permission>();
  for (const { role } of user.roles) {
    for (const { permission } of role.permissions) {
      // Ignora chaves no banco que não existem mais no catálogo do código.
      if (isPermission(permission.key)) permissions.add(permission.key);
    }
  }
  return {
    sessionId,
    user: { id: user.id, name: user.name, email: user.email },
    roles: user.roles.map(({ role }) => role.key),
    permissions,
  };
}

export function toMe(auth: AuthContext): Me {
  return {
    ...auth.user,
    roles: auth.roles,
    permissions: [...auth.permissions].sort(),
  };
}
