import { z } from 'zod';
import { emailSchema } from './auth.js';

/** Política de senha: comprimento acima de complexidade (recomendação NIST 800-63B). */
export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter pelo menos 10 caracteres')
  .max(256, 'A senha deve ter no máximo 256 caracteres');

export const ROLE_KEYS = ['ADMIN', 'GERENTE', 'VENDEDOR', 'ESTOQUISTA'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Nome e resumo de cada papel, para a interface (as permissões em si ficam na API). */
export const ROLE_LABELS: Record<RoleKey, { name: string; summary: string }> = {
  ADMIN: { name: 'Administrador', summary: 'Acesso total, inclusive usuários' },
  GERENTE: { name: 'Gerente', summary: 'Tudo, exceto gerir usuários' },
  VENDEDOR: { name: 'Vendedor', summary: 'Caixa e consulta de vendas' },
  ESTOQUISTA: { name: 'Estoquista', summary: 'Entradas e consulta de estoque' },
};

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120),
  email: emailSchema,
  password: passwordSchema,
  roles: z.array(z.enum(ROLE_KEYS)).min(1, 'Informe ao menos um papel'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  active: z.boolean(),
  roles: z.array(z.string()),
  createdAt: z.iso.datetime(),
});

export type User = z.infer<typeof userSchema>;

/** O próprio usuário troca a senha: exige a atual (quem roubou só a sessão não consegue). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual').max(256),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'A nova senha deve ser diferente da atual',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Administrador define uma senha nova para outro usuário (ex.: esqueceu a senha). */
export const resetPasswordSchema = z.object({ newPassword: passwordSchema });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const updateUserRolesSchema = z.object({
  roles: z.array(z.enum(ROLE_KEYS)).min(1, 'Informe ao menos um papel'),
});
export type UpdateUserRolesInput = z.infer<typeof updateUserRolesSchema>;
