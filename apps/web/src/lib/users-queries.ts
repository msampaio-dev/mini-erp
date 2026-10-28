import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { userSchema, type CreateUserInput } from '@mini-erp/contracts'
import { z } from 'zod'
import { apiGet, apiPost, apiPostNoContent } from './api.ts'

const usersKey = ['users'] as const

export function useUsers() {
  return useQuery({ queryKey: usersKey, queryFn: () => apiGet('/users', z.array(userSchema)) })
}

function useUsersMutation<T>(fn: (vars: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }) })
}

export const useCreateUser = () => useUsersMutation((input: CreateUserInput) => apiPost('/users', input, userSchema))

export const useSetUserActive = () =>
  useUsersMutation(({ id, active }: { id: string; active: boolean }) =>
    apiPostNoContent(`/users/${id}/${active ? 'activate' : 'deactivate'}`),
  )
