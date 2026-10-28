import type { z } from 'zod'

/** Erro HTTP da API, com a mensagem e os erros por campo que o Nest devolve. */
export class ApiError extends Error {
  readonly status: number
  /** Código de erro de negócio, quando a API envia um (ex.: VERSION_CONFLICT). */
  readonly code: string | undefined
  readonly fieldErrors: { path: string; message: string }[]

  constructor(status: number, body: unknown) {
    const b = (body ?? {}) as { message?: unknown; errors?: unknown; code?: unknown }
    super(typeof b.message === 'string' ? b.message : `Erro ${status}`)
    this.status = status
    this.code = typeof b.code === 'string' ? b.code : undefined
    this.fieldErrors = Array.isArray(b.errors) ? b.errors : []
  }
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`/api${path}`, {
    method,
    // 'include' envia o cookie de sessão; como front e API estão na mesma origem
    // (proxy do Vite em dev, proxy reverso em produção), não há CORS no caminho.
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

/**
 * Toda resposta é validada pelo schema do @mini-erp/contracts: se a API mudar
 * o formato, o erro aparece aqui, explícito, em vez de um `undefined` misterioso na tela.
 */
export async function apiGet<T extends z.ZodType>(path: string, schema: T): Promise<z.output<T>> {
  return schema.parse(await call('GET', path))
}

export async function apiSend<T extends z.ZodType>(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  body: unknown,
  schema: T,
): Promise<z.output<T>> {
  return schema.parse(await call(method, path, body))
}

export async function apiPost<T extends z.ZodType>(path: string, body: unknown, schema: T) {
  return apiSend('POST', path, body, schema)
}

export async function apiPostNoContent(path: string, body?: unknown): Promise<void> {
  await call('POST', path, body)
}

/** Monta a query string ignorando valores vazios. */
export function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

export async function apiDelete(path: string): Promise<void> {
  await call('DELETE', path)
}
