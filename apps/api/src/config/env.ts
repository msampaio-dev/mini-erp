import { z } from 'zod';

/**
 * Contrato das variáveis de ambiente.
 * A aplicação NÃO sobe se alguma estiver faltando ou inválida (fail fast):
 * é melhor quebrar no deploy do que às 3h da manhã na primeira query.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  WEB_ORIGIN: z.url().default('http://localhost:5180'),
  /** Inatividade máxima antes da sessão expirar (expiração deslizante). */
  SESSION_TTL_HOURS: z.coerce.number().positive().max(720).default(8),
  /** Tentativas de login por IP por minuto (proteção contra força bruta). */
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
