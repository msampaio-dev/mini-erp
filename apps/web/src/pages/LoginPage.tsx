import { useState, type FormEvent } from 'react'
import { loginSchema } from '@mini-erp/contracts'
import { useAuth } from '../auth/auth-context.ts'
import { ApiError } from '../lib/api.ts'

export function LoginPage() {
  const { login } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    // O MESMO schema que a API usa: o erro aparece na hora, sem ida ao servidor.
    const parsed = loginSchema.safeParse(Object.fromEntries(form))
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await login(parsed.data)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Muitas tentativas. Aguarde um minuto e tente de novo.'
          : err instanceof Error
            ? err.message
            : 'Erro inesperado',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="card">
      <h1>Mini-ERP</h1>
      <p className="muted">Entre com sua conta</p>
      <form onSubmit={onSubmit} noValidate>
        <label>
          E-mail
          <input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <label>
          Senha
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
