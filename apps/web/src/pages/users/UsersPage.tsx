import { useState, type FormEvent } from 'react'
import { createUserSchema, resetPasswordSchema, ROLE_KEYS, ROLE_LABELS, type RoleKey, type User } from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { ApiError } from '../../lib/api.ts'
import {
  useCreateUser,
  useResetUserPassword,
  useSetUserActive,
  useUpdateUserRoles,
  useUsers,
} from '../../lib/users-queries.ts'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })
const roleNames = (roles: string[]) => roles.map((r) => ROLE_LABELS[r as RoleKey]?.name ?? r).join(', ')

export function UsersPage() {
  const { me } = useAuth()
  const { data, isPending, isError, error } = useUsers()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)

  return (
    <section>
      <div className="row">
        <h1>Usuários</h1>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}>
            Novo usuário
          </button>
        )}
      </div>
      {creating && <CreateUserForm onDone={() => setCreating(false)} />}
      {editing && <EditUserPanel key={editing.id} user={editing} onDone={() => setEditing(null)} />}

      {isPending && <p className="muted">Carregando…</p>}
      {isError && <p className="error">Não foi possível carregar: {error.message}</p>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Papéis</th>
                <th>Desde</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <UserRow key={u.id} user={u} isMe={u.id === me?.id} onEdit={() => setEditing(u)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small-text">
        Usuários não são apagados: desativar corta o acesso na hora (todas as sessões caem) e preserva o histórico de
        vendas e movimentações feitas por eles.
      </p>
    </section>
  )
}

function UserRow({ user, isMe, onEdit }: { user: User; isMe: boolean; onEdit: () => void }) {
  const setActive = useSetUserActive()
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (user.active && !window.confirm(`Desativar ${user.name}? O acesso dele cai imediatamente.`)) return
    setError(null)
    try {
      await setActive.mutateAsync({ id: user.id, active: !user.active })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <tr className={user.active ? undefined : 'reversed'}>
      <td>
        {user.name} {isMe && <span className="muted">(você)</span>}
      </td>
      <td>{user.email}</td>
      <td>{roleNames(user.roles)}</td>
      <td>{dateFmt.format(new Date(user.createdAt))}</td>
      <td>
        <span className={`badge ${user.active ? 'badge-ok' : 'badge-off'}`}>{user.active ? 'Ativo' : 'Inativo'}</span>
      </td>
      <td>
        {/* A API também barra: ninguém desativa a si mesmo (evita trancar o sistema). */}
        {!isMe && (
          <div className="inline">
            <button type="button" className="secondary small" onClick={onEdit}>
              Editar
            </button>
            <button type="button" className="secondary small" disabled={setActive.isPending} onClick={() => void toggle()}>
              {user.active ? 'Desativar' : 'Reativar'}
            </button>
          </div>
        )}
        {error && <div className="field-error">{error}</div>}
      </td>
    </tr>
  )
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const create = useCreateUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<RoleKey[]>(['VENDEDOR'])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  function toggleRole(role: RoleKey) {
    setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const parsed = createUserSchema.safeParse({ name, email, password, roles })
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    setErrors({})
    try {
      await create.mutateAsync(parsed.data)
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setErrors({ email: err.message })
      else setFormError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <form className="panel movement-form" onSubmit={onSubmit} noValidate>
      <h2 className="wide">Novo usuário</h2>
      <label>
        Nome
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>
      <label>
        E-mail
        <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        {errors.email && <span className="field-error">{errors.email}</span>}
      </label>
      <label>
        Senha inicial (mín. 10 caracteres)
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {errors.password && <span className="field-error">{errors.password}</span>}
      </label>
      <fieldset className="roles">
        <legend>Papéis</legend>
        {ROLE_KEYS.map((role) => (
          <label key={role} className="check">
            <input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} />
            <span>
              <strong>{ROLE_LABELS[role].name}</strong> <span className="muted">· {ROLE_LABELS[role].summary}</span>
            </span>
          </label>
        ))}
        {errors.roles && <span className="field-error">{errors.roles}</span>}
      </fieldset>
      {formError && (
        <p className="error wide" role="alert">
          {formError}
        </p>
      )}
      <div className="actions wide">
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Criando…' : 'Criar usuário'}
        </button>
      </div>
    </form>
  )
}

/** Papéis e senha de outro usuário. Mudança de papéis vale na próxima ação dele, sem novo login. */
function EditUserPanel({ user, onDone }: { user: User; onDone: () => void }) {
  const updateRoles = useUpdateUserRoles()
  const resetPassword = useResetUserPassword()
  const [roles, setRoles] = useState<RoleKey[]>(user.roles.filter((r): r is RoleKey => r in ROLE_LABELS))
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function saveRoles() {
    if (roles.length === 0) return setMessage({ kind: 'error', text: 'Informe ao menos um papel' })
    try {
      await updateRoles.mutateAsync({ id: user.id, roles })
      setMessage({ kind: 'ok', text: 'Papéis atualizados. Valem a partir da próxima ação do usuário.' })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Erro inesperado' })
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    const parsed = resetPasswordSchema.safeParse({ newPassword })
    if (!parsed.success) return setMessage({ kind: 'error', text: parsed.error.issues[0]?.message ?? 'Senha inválida' })
    try {
      await resetPassword.mutateAsync({ id: user.id, newPassword })
      setNewPassword('')
      setMessage({ kind: 'ok', text: `Senha redefinida. ${user.name} foi desconectado e entra com a senha nova.` })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Erro inesperado' })
    }
  }

  return (
    <div className="panel">
      <div className="row">
        <h2>Editar {user.name}</h2>
        <button type="button" className="secondary small" onClick={onDone}>
          Fechar
        </button>
      </div>

      <fieldset className="roles">
        <legend>Papéis</legend>
        {ROLE_KEYS.map((role) => (
          <label key={role} className="check">
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={() => setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]))}
            />
            <span>
              <strong>{ROLE_LABELS[role].name}</strong> <span className="muted">· {ROLE_LABELS[role].summary}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="actions">
        <button type="button" disabled={updateRoles.isPending} onClick={() => void saveRoles()}>
          Salvar papéis
        </button>
      </div>

      <form className="inline reset-password" onSubmit={savePassword} noValidate>
        <input
          type="password"
          autoComplete="new-password"
          aria-label="Nova senha"
          placeholder="Nova senha (mín. 10 caracteres)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <button type="submit" className="secondary" disabled={resetPassword.isPending}>
          Redefinir senha
        </button>
      </form>

      {message && (
        <p className={message.kind === 'ok' ? 'up' : 'error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </div>
  )
}
