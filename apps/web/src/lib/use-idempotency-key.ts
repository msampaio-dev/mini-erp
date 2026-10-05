import { useCallback, useState } from 'react'

/**
 * Uma chave por OPERAÇÃO, não por requisição:
 * - nasce quando o formulário abre;
 * - é reutilizada em reenvios (clique duplo, retry após erro de rede);
 * - só é trocada depois de uma operação concluída com sucesso.
 */
export function useIdempotencyKey(): [string, () => void] {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const renew = useCallback(() => setKey(crypto.randomUUID()), [])
  return [key, renew]
}
