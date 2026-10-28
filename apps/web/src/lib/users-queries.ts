import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { userSchema, type ChangePasswordInput, type CreateUserInput, type RoleKey } from '@mini-erp/contracts'
import { z } from 'zod'
import { apiGet, apiPost, apiPostNoContent, apiSend } from './api.ts'

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

export const useUpdateUserRoles = () =>
  useUsersMutation(({ id, roles }: { id: string; roles: RoleKey[] }) =>
    apiSend('PUT', `/users/${id}/roles`, { roles }, userSchema),
  )

export const useResetUserPassword = () =>
  useUsersMutation(({ id, newPassword }: { id: string; newPassword: string }) =>
    apiPostNoContent(`/users/${id}/password`, { newPassword }),
  )

/** Troca da própria senha (não mexe na lista de usuários). */
export const useChangeOwnPassword = () =>
  useMutation({ mutationFn: (input: ChangePasswordInput) => apiPostNoContent('/auth/password', input) })
