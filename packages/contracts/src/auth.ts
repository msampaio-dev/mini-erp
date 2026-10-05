import { z } from 'zod';
import { ALL_PERMISSIONS } from './permissions.js';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('E-mail inválido'));

export const loginSchema = z.object({
  email: emailSchema,
  // Sem regra de força aqui: no login só checamos se veio algo.
  password: z.string().min(1, 'Informe a senha').max(256),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Usuário autenticado como o front o enxerga (GET /api/auth/me). */
export const meSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  roles: z.array(z.string()),
  permissions: z.array(z.enum(ALL_PERMISSIONS)),
});

export type Me = z.infer<typeof meSchema>;
