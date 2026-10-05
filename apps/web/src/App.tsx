import { useAuth } from './auth/auth-context.ts'
import { HomePage } from './pages/HomePage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'

export default function App() {
  const { me } = useAuth()

  if (me === undefined) return <p className="card muted">Carregando…</p>
  return me ? <HomePage /> : <LoginPage />
}
