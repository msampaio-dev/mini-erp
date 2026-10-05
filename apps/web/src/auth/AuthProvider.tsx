import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { meSchema, type LoginInput, type Me } from '@mini-erp/contracts'
import { ApiError, apiGet, apiPost, apiPostNoContent } from '../lib/api.ts'
import { AUTH_EXPIRED_EVENT } from '../lib/query-client.ts'
import { AuthContext, type AuthState } from './auth-context.ts'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const queryClient = useQueryClient()

  // Ao trocar de usuário, o cache de dados é descartado: o próximo usuário
  // nunca vê, nem por um instante, dados carregados pelo anterior.
  const endSession = useCallback(() => {
    queryClient.clear()
    setMe(null)
  }, [queryClient])

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

  // Sessão expirou ou foi revogada (usuário desativado) no meio do uso: volta ao login.
  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, endSession)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, endSession)
  }, [endSession])

  const login = useCallback(async (input: LoginInput) => {
    setMe(await apiPost('/auth/login', input, meSchema))
  }, [])

  const logout = useCallback(async () => {
    await apiPostNoContent('/auth/logout')
    endSession()
  }, [endSession])

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
