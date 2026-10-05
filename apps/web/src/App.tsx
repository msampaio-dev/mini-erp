import { useEffect, useState } from 'react'
import { healthResponseSchema, type HealthResponse } from '@mini-erp/contracts'
import { apiGet } from './lib/api.ts'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'error'; message: string }

// Tela provisória da Fase 1: prova que front → API → banco estão ligados.
export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    apiGet('/health', healthResponseSchema)
      .then((health) => setState({ kind: 'ready', health }))
      .catch((err: unknown) =>
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
  }, [])

  return (
    <main className="status">
      <h1>Mini-ERP</h1>
      <p>Fase 1: fundação</p>
      {state.kind === 'loading' && <p>Verificando a API…</p>}
      {state.kind === 'error' && <p className="down">API inacessível: {state.message}</p>}
      {state.kind === 'ready' && (
        <ul>
          <li className={state.health.status === 'ok' ? 'up' : 'down'}>API: {state.health.status}</li>
          <li className={state.health.database === 'up' ? 'up' : 'down'}>
            Banco: {state.health.database}
          </li>
        </ul>
      )}
    </main>
  )
}
