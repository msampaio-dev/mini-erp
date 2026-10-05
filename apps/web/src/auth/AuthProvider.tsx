import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { meSchema, type LoginInput, type Me } from '@mini-erp/contracts'
import { ApiError, apiGet, apiPost, apiPostNoContent } from '../lib/api.ts'
import { AuthContext, type AuthState } from './auth-context.ts'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined)

  // Ao abrir o app, pergunta à API se o cookie ainda vale.
  // O front não consegue ler o cookie (httpOnly), então essa é a única forma de saber.
  useEffect(() => {
    apiGet('/auth/me', meSchema)
      .then(setMe)
      .catch((err: unknown) => {
        // 401 é o caso normal (não logado). Outros erros (API fora) também levam ao
        // login, mas ficam registrados no console para diagnóstico.
        if (!(err instanceof ApiError && err.status === 401)) console.error(err)
        setMe(null)
      })
  }, [])

  const login = useCallback(async (input: LoginInput) => {
    setMe(await apiPost('/auth/login', input, meSchema))
  }, [])

  const logout = useCallback(async () => {
    await apiPostNoContent('/auth/logout')
    setMe(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      me,
      login,
      logout,
      can: (permission) => me?.permissions.includes(permission) ?? false,
    }),
    [me, login, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
