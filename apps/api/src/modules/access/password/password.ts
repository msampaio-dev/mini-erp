import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/**
 * Parâmetros mínimos recomendados pela OWASP para Argon2id:
 * 19 MiB de memória, 2 iterações, paralelismo 1.
 * Ficam gravados dentro do próprio hash (formato PHC), então podem ser
 * endurecidos no futuro sem invalidar as senhas antigas (ver needsRehash).
 */
const CURRENT = { memory: 19_456, passes: 2, parallelism: 1 } as const;
const SALT_BYTES = 16;
const TAG_BYTES = 32;
const ARGON2_VERSION = 19; // 0x13

type Params = { memory: number; passes: number; parallelism: number };

// Formato PHC: $argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64>
const PHC_PATTERN = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

function derive(password: string, salt: Buffer, params: Params, tagLength: number) {
  return argon2Async('argon2id', {
    message: password,
    nonce: salt,
    memory: params.memory,
    passes: params.passes,
    parallelism: params.parallelism,
    tagLength,
  });
}

function parse(phc: string) {
  const m = PHC_PATTERN.exec(phc);
  if (!m || Number(m[1]) !== ARGON2_VERSION) return null;
  return {
    params: { memory: Number(m[2]), passes: Number(m[3]), parallelism: Number(m[4]) },
    salt: Buffer.from(m[5]!, 'base64'),
    hash: Buffer.from(m[6]!, 'base64'),
  };
}

export async function hashPassword(password: string): Promise<string> {
  // Salt aleatório por senha: duas pessoas com a mesma senha têm hashes diferentes,
  // o que inutiliza tabelas pré-computadas (rainbow tables).
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, CURRENT, TAG_BYTES);
  const { memory: m, passes: t, parallelism: p } = CURRENT;
  return `$argon2id$v=${ARGON2_VERSION}$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  const parsed = parse(phc);
  if (!parsed) return false;
  const candidate = await derive(password, parsed.salt, parsed.params, parsed.hash.length);
  // Comparação em tempo constante: `===` pararia no primeiro byte diferente,
  // e o tempo de resposta vazaria quantos bytes o atacante acertou.
  return timingSafeEqual(candidate, parsed.hash);
}

/** true se o hash foi gerado com parâmetros mais fracos que os atuais. */
export function needsRehash(phc: string): boolean {
  const parsed = parse(phc);
  if (!parsed) return true;
  const { memory, passes, parallelism } = parsed.params;
  return (
    memory < CURRENT.memory || passes < CURRENT.passes || parallelism !== CURRENT.parallelism
  );
}
