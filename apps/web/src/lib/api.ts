import type { z } from 'zod'

/**
 * Cliente HTTP mínimo. Toda resposta é validada pelo schema do
 * @mini-erp/contracts: se a API mudar o formato, o erro aparece aqui,
 * explícito, em vez de um `undefined` misterioso lá na tela.
 */
export async function apiGet<T extends z.ZodType>(path: string, schema: T): Promise<z.output<T>> {
  const res = await fetch(`/api${path}`, { credentials: 'include' })
  const body: unknown = await res.json().catch(() => null)
  return schema.parse(body)
}
