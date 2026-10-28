import { ALL_PERMISSIONS, PERMISSIONS } from '@mini-erp/contracts'
import { useAuth } from '../auth/auth-context.ts'
import { ChangePasswordForm } from './ChangePasswordForm.tsx'

/** Quem sou eu e o que posso fazer: útil para o usuário entender por que algo não aparece. */
export function ProfilePage() {
  const { me, can } = useAuth()
  if (!me) return null

  return (
    <section className="narrow">
      <h1>Meu acesso</h1>
      <p className="muted">
        {me.email} · {me.roles.join(', ')}
      </p>

      <h2>Permissões</h2>
      <ul className="permissions">
        {ALL_PERMISSIONS.map((p) => (
          <li key={p} className={can(p) ? 'up' : 'off'}>
            <span aria-hidden>{can(p) ? '✓' : '–'}</span> {PERMISSIONS[p]}
          </li>
        ))}
      </ul>

      <ChangePasswordForm />
    </section>
  )
}
