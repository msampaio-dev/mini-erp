import type { ReactNode } from 'react'
import type { Permission } from '@mini-erp/contracts'
import { useAuth } from '../auth/auth-context.ts'

/**
 * Esconde a tela de quem não tem a permissão. É conforto de interface:
 * mesmo que alguém force a URL, a API responde 403 (ADR 0008).
 */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(permission)) {
    return (
      <section className="empty">
        <h1>Sem permissão</h1>
        <p className="muted">Seu perfil não tem acesso a esta tela. Fale com um administrador.</p>
      </section>
    )
  }
  return children
}
