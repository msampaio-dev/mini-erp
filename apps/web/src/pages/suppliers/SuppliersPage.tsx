import { useState, type FormEvent } from 'react'
import { formatDocument, supplierInputSchema, type Supplier } from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { ApiError } from '../../lib/api.ts'
import { useDebouncedValue } from '../../lib/use-debounced-value.ts'
import { useSaveSupplier, useSetSupplierActive, useSuppliers } from '../../lib/suppliers-queries.ts'

type Errors = Record<string, string | undefined>

/** Fornecedores (ADR 0021): de quem a mercadoria vem. Desativar, nunca apagar. */
export function SuppliersPage() {
  const { can } = useAuth()
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const query = useDebouncedValue(q.trim(), 300)
  const { data, isPending, isError, error } = useSuppliers(query, showInactive ? 'all' : 'true', 1)
  const setActive = useSetSupplierActive()
  const manage = can('fornecedores:gerenciar')

  return (
    <section>
      <div className="row">
        <h1>Fornecedores</h1>
        {manage && editing === null && (
          <button type="button" onClick={() => setEditing('new')}>
            Novo fornecedor
          </button>
        )}
      </div>
      {editing !== null && (
        <SupplierForm
          key={editing === 'new' ? 'new' : editing.id}
          supplier={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
      <div className="filters">
        <input
          type="search"
          placeholder="Nome ou CNPJ/CPF"
          aria-label="Buscar fornecedor"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar desativados
        </label>
      </div>
      {isPending ? (
        <p className="muted">Carregando…</p>
      ) : isError ? (
        <p className="error">{error.message}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>CNPJ/CPF</th>
                <th>Contato</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className={s.active ? undefined : 'reversed'}>
                  <td>
                    {s.name}
                    {!s.active && <span className="badge badge-off">desativado</span>}
                    {s.note && <div className="muted">{s.note}</div>}
                  </td>
                  <td className="mono">{s.document ? formatDocument(s.document) : '—'}</td>
                  <td>{[s.phone, s.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="row-actions">
                    {manage && (
                      <>
                        <button type="button" className="secondary small" onClick={() => setEditing(s)}>
                          Editar
                        </button>{' '}
                        <button
                          type="button"
                          className="secondary small"
                          disabled={setActive.isPending}
                          onClick={() => setActive.mutate({ id: s.id, active: !s.active })}
                        >
                          {s.active ? 'Desativar' : 'Reativar'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted center">
                    Nenhum fornecedor.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SupplierForm({ supplier, onDone }: { supplier: Supplier | null; onDone: () => void }) {
  const save = useSaveSupplier(supplier?.id)
  const [values, setValues] = useState({
    name: supplier?.name ?? '',
    document: supplier?.document ? formatDocument(supplier.document) : '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    note: supplier?.note ?? '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const set = (k: keyof typeof values) => (v: string) => setValues((s) => ({ ...s, [k]: v }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    // Mesmo schema da API: CNPJ/CPF conferido pelos dígitos antes de enviar.
    const parsed = supplierInputSchema.safeParse(values)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    try {
      await save.mutateAsync(parsed.data)
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) {
        setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message])))
      } else setFormError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  const field = (key: keyof typeof values, label: string, props: Record<string, string> = {}) => (
    <label>
      {label}
      <input value={values[key]} onChange={(e) => set(key)(e.target.value)} {...props} />
      {errors[key] && <span className="field-error">{errors[key]}</span>}
    </label>
  )

  return (
    <form className="panel movement-form" onSubmit={onSubmit} noValidate>
      <h2>{supplier ? `Editar ${supplier.name}` : 'Novo fornecedor'}</h2>
      {field('name', 'Nome')}
      {field('document', 'CNPJ ou CPF (opcional)', { inputMode: 'numeric' })}
      {field('phone', 'Telefone')}
      {field('email', 'E-mail', { type: 'email' })}
      <label className="wide">
        Observação
        <input value={values.note} onChange={(e) => set('note')(e.target.value)} />
      </label>
      {formError && (
        <p className="error wide" role="alert">
          {formError}
        </p>
      )}
      <div className="actions wide">
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}
