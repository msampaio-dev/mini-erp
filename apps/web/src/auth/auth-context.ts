import { createContext, useContext } from 'react'
import type { LoginInput, Me, Permission } from '@mini-erp/contracts'

export interface AuthState {
  /** undefined = ainda verificando a sessão; null = deslogado. */
  me: Me | null | undefined
  login: (input: LoginInput) => Promise<void>
  logout: () => Promise<void>
  /**
   * Só para a INTERFACE (esconder botão, menu). Quem garante a segurança é a API:
   * esconder um botão nunca substitui o @RequirePermission no backend.
   */
  can: (permission: Permission) => boolean
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
