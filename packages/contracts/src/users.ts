import { z } from 'zod';
import { emailSchema } from './auth.js';

/** Política de senha: comprimento acima de complexidade (recomendação NIST 800-63B). */
export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter pelo menos 10 caracteres')
  .max(256, 'A senha deve ter no máximo 256 caracteres');

export const ROLE_KEYS = ['ADMIN', 'GERENTE', 'VENDEDOR', 'ESTOQUISTA'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

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
