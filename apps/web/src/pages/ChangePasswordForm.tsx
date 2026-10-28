import { useState, type FormEvent } from 'react'
import { changePasswordSchema } from '@mini-erp/contracts'
import { ApiError } from '../lib/api.ts'
import { useChangeOwnPassword } from '../lib/users-queries.ts'

export function ChangePasswordForm() {
  const change = useChangeOwnPassword()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setDone(false)
    if (newPassword !== confirm) {
      setErrors({ confirm: 'As senhas não conferem' })
      return
    }
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword })
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    setErrors({})
    try {
      await change.mutateAsync(parsed.data)
      setCurrent('')
      setNew('')
      setConfirm('')
      setDone(true)
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message])))
      } else {
        setErrors({ form: err instanceof Error ? err.message : 'Erro inesperado' })
      }
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit} noValidate>
      <h2>Alterar senha</h2>
      <p className="muted small-text">Ao trocar, você continua conectado aqui e é desconectado dos outros aparelhos.</p>
      <label>
        Senha atual
        <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
        {errors.currentPassword && <span className="field-error">{errors.currentPassword}</span>}
      </label>
      <label>
        Nova senha (mín. 10 caracteres)
        <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
        {errors.newPassword && <span className="field-error">{errors.newPassword}</span>}
      </label>
      <label>
        Confirme a nova senha
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {errors.confirm && <span className="field-error">{errors.confirm}</span>}
      </label>
      {errors.form && <p className="error" role="alert">{errors.form}</p>}
      {done && <p className="up" role="status">Senha alterada.</p>}
      <div className="actions">
        <button type="submit" disabled={change.isPending}>
          {change.isPending ? 'Salvando…' : 'Alterar senha'}
        </button>
      </div>
    </form>
  )
}
