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
  /**
   * Quantos proxies reversos confiáveis há na frente da API (Caddy = 1).
   * Sem isso, atrás do proxy todo cliente "tem o IP do proxy": o rate limit de login
   * bloquearia todo mundo junto. Nunca confiar em mais saltos do que existem de fato:
   * o cliente poderia forjar o X-Forwarded-For.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Modo "um serviço só" (Render, ADR 0015): pasta com o build do React. Se definida, a API
   * também serve o front, na MESMA origem (cookies de sessão simples, sem CORS).
   */
  WEB_DIST_DIR: z.string().min(1).optional(),
  /** Dados da loja no cupom (ADR 0020). O cupom é "sem valor fiscal" enquanto não houver NFC-e. */
  STORE_NAME: z.string().trim().min(1).default('Mini-ERP'),
  STORE_DOCUMENT: z.string().trim().default(''),
  STORE_ADDRESS: z.string().trim().default(''),
  /** O que a balança imprime na etiqueta: peso em gramas (recomendado) ou preço total. */
  SCALE_LABEL_MODE: z.enum(['WEIGHT', 'PRICE']).default('WEIGHT'),
  /** Liga GET /api/health/client-ip, para descobrir o TRUST_PROXY certo num provedor novo. */
  DIAGNOSTICS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // No Render, a URL pública vem pronta em RENDER_EXTERNAL_URL.
  const withDefaults = { ...raw, WEB_ORIGIN: raw['WEB_ORIGIN'] ?? raw['RENDER_EXTERNAL_URL'] };
  const result = envSchema.safeParse(withDefaults);
  if (!result.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
