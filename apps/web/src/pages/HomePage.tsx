import { ALL_PERMISSIONS, PERMISSIONS } from '@mini-erp/contracts'
import { useAuth } from '../auth/auth-context.ts'

// Tela provisória da Fase 2: mostra quem está logado e o que essa pessoa pode fazer.
export function HomePage() {
  const { me, logout, can } = useAuth()
  if (!me) return null

  return (
    <main className="card">
      <header className="row">
        <div>
          <h1>Olá, {me.name}</h1>
          <p className="muted">
            {me.email} · {me.roles.join(', ')}
          </p>
        </div>
        <button type="button" className="secondary" onClick={() => void logout()}>
          Sair
        </button>
      </header>

      <h2>Suas permissões</h2>
      <ul className="permissions">
        {ALL_PERMISSIONS.map((p) => (
          <li key={p} className={can(p) ? 'up' : 'off'}>
            <span aria-hidden>{can(p) ? '✓' : '–'}</span> {PERMISSIONS[p]}
          </li>
        ))}
      </ul>
    </main>
  )
}
