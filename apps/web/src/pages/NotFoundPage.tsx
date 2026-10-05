import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <section className="empty">
      <h1>Página não encontrada</h1>
      <p className="muted">
        <Link to="/">Voltar ao início</Link>
      </p>
    </section>
  )
}
