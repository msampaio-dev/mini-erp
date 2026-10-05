import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api.ts'

export const AUTH_EXPIRED_EVENT = 'auth:expired'

/** Qualquer 401 (sessão expirou ou foi revogada) avisa o AuthProvider para voltar ao login. */
function onError(err: unknown) {
  if (err instanceof ApiError && err.status === 401) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      // Erro 4xx é resposta definitiva (sem permissão, não encontrado): tentar de novo não adianta.
      retry: (failureCount, err) =>
        !(err instanceof ApiError && err.status < 500) && failureCount < 2,
      // Dados considerados frescos por 30s: navegar entre telas não refaz a requisição.
      staleTime: 30_000,
    },
  },
})
