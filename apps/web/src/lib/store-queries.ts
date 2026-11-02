import { useQuery } from '@tanstack/react-query'
import { storeSettingsSchema } from '@mini-erp/contracts'
import { apiGet } from './api.ts'

/** Dados da loja e configuração do PDV: mudam só com novo deploy, então ficam em cache. */
export function useStoreSettings() {
  return useQuery({
    queryKey: ['store', 'settings'],
    queryFn: () => apiGet('/store/settings', storeSettingsSchema),
    staleTime: Infinity,
  })
}
