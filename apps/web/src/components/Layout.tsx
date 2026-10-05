import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/auth-context.ts'

export function Layout() {
  const { me, logout, can } = useAuth()

  return (
    <>
      <header className="topbar">
        <strong className="brand">Mini-ERP</strong>
        <nav>
          {can('produtos:ler') && <NavLink to="/produtos">Produtos</NavLink>}
          <NavLink to="/meu-acesso">Meu acesso</NavLink>
        </nav>
        <div className="topbar-user">
          <span className="muted">{me?.name}</span>
          <button type="button" className="secondary small" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  )
}
