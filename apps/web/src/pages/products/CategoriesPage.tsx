import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { createCategorySchema, type Category } from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { useCategories, useCreateCategory, useDeleteCategory, useRenameCategory } from '../../lib/catalog-queries.ts'

export function CategoriesPage() {
  const { can } = useAuth()
  const editable = can('produtos:gerenciar')
  const { data, isPending, isError, error } = useCategories()
  const create = useCreateCategory()
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    const parsed = createCategorySchema.safeParse({ name })
    if (!parsed.success) return setFormError(parsed.error.issues[0]?.message ?? 'Nome inválido')
    try {
      await create.mutateAsync(parsed.data)
      setName('')
      setFormError(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <section className="narrow">
      <p className="muted breadcrumb">
        <Link to="/produtos">Produtos</Link> / Categorias
      </p>
      <h1>Categorias</h1>

      {editable && (
        <form className="inline new-category" onSubmit={onCreate} noValidate>
          <input aria-label="Nova categoria" placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={create.isPending}>
            Adicionar
          </button>
        </form>
      )}
      {formError && <p className="error">{formError}</p>}

      {isPending && <p className="muted">Carregando…</p>}
      {isError && <p className="error">Não foi possível carregar: {error.message}</p>}
      {data && (
        <div className="table-wrap">
          <table>
            <tbody>
              {data.map((c) => (
                <CategoryRow key={c.id} category={c} editable={editable} />
              ))}
              {data.length === 0 && (
                <tr>
                  <td className="muted center">Nenhuma categoria ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small-text">Só é possível excluir uma categoria que nenhum produto usa.</p>
    </section>
  )
}

function CategoryRow({ category, editable }: { category: Category; editable: boolean }) {
  const rename = useRenameCategory()
  const remove = useDeleteCategory()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const [error, setError] = useState<string | null>(null)

  async function onSave(e: FormEvent) {
    e.preventDefault()
    const parsed = createCategorySchema.safeParse({ name })
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Nome inválido')
    try {
      await rename.mutateAsync({ id: category.id, name: parsed.data.name })
      setEditing(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  async function onDelete() {
    if (!window.confirm(`Excluir a categoria "${category.name}"?`)) return
    try {
      await remove.mutateAsync(category.id)
    } catch (err) {
      // Ex.: "Categoria em uso por 3 produto(s)..."
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <tr>
      <td>
        {editing ? (
          <form className="inline" onSubmit={onSave} noValidate>
            <input autoFocus aria-label="Nome da categoria" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="small" disabled={rename.isPending}>
              Salvar
            </button>
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                setEditing(false)
                setName(category.name)
                setError(null)
              }}
            >
              Cancelar
            </button>
          </form>
        ) : (
          category.name
        )}
        {error && <div className="field-error">{error}</div>}
      </td>
      {editable && !editing && (
        <td className="num">
          <div className="inline row-actions">
            <button type="button" className="secondary small" onClick={() => setEditing(true)}>
              Renomear
            </button>
            <button type="button" className="secondary small" disabled={remove.isPending} onClick={() => void onDelete()}>
              Excluir
            </button>
          </div>
        </td>
      )}
    </tr>
  )
}
