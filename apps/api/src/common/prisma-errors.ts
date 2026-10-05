import { Prisma } from '../generated/prisma/client.js';

type UniqueMeta = {
  target?: unknown;
  driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
};

/**
 * Se o erro for violação de UNIQUE (P2002), devolve um texto identificando o alvo
 * (nome do índice e/ou campos, ex.: "products_barcode_key"); senão, null.
 * Permite o padrão "tenta gravar e trata o conflito" em vez de "consulta antes":
 * a consulta prévia tem condição de corrida, a constraint do banco não.
 *
 * O formato do meta varia: o engine clássico usa `target` (campos); o adapter `pg`
 * informa `constraint.index` (nome do índice). Cobrimos os dois.
 */
export function uniqueViolationTarget(err: unknown): string | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null;
  const meta = err.meta as UniqueMeta | undefined;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  return [meta?.target, constraint?.fields, constraint?.index]
    .flat()
    .filter((v) => v !== undefined && v !== null)
    .map(String)
    .join(' ');
}

/** Violação de chave estrangeira (P2003): a linha referenciada não existe. */
export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

/** Registro alvo de update/delete não encontrado (P2025). */
export function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}
