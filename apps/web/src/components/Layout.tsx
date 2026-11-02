import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/auth-context.ts'

export function Layout() {
  const { me, logout, can } = useAuth()

  return (
    <>
      <header className="topbar">
        <strong className="brand">Mini-ERP</strong>
        <nav>
          {can('vendas:criar') && <NavLink to="/vendas/nova">PDV</NavLink>}
          {can('caixa:operar') && <NavLink to="/caixa">Caixa</NavLink>}
          {can('vendas:ler') && (
            <NavLink to="/vendas" end>
              Vendas
            </NavLink>
          )}
          {can('produtos:ler') && <NavLink to="/produtos">Produtos</NavLink>}
          {can('fornecedores:ler') && <NavLink to="/fornecedores">Fornecedores</NavLink>}
          {can('relatorios:ler') && <NavLink to="/relatorios">Relatórios</NavLink>}
          {can('usuarios:gerenciar') && <NavLink to="/usuarios">Usuários</NavLink>}
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
