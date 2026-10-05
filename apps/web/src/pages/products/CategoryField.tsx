import { useState } from 'react'
import { createCategorySchema } from '@mini-erp/contracts'
import { useCategories, useCreateCategory } from '../../lib/catalog-queries.ts'

interface Props {
  value: string
  onChange: (categoryId: string) => void
  disabled: boolean
  canCreate: boolean
}

/** Select de categorias com criação rápida, sem sair do formulário de produto. */
export function CategoryField({ value, onChange, disabled, canCreate }: Props) {
  const { data: categories = [] } = useCategories()
  const createCategory = useCreateCategory()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const parsed = createCategorySchema.safeParse({ name })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Nome inválido')
      return
    }
    try {
      const category = await createCategory.mutateAsync(parsed.data)
      onChange(category.id)
      setCreating(false)
      setName('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar categoria')
    }
  }

  return (
    <div className="field">
      <label htmlFor="categoryId">Categoria</label>
      {creating ? (
        <div className="inline">
          <input
            autoFocus
            value={name}
            placeholder="Nome da nova categoria"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
          />
          <button type="button" className="small" onClick={() => void save()} disabled={createCategory.isPending}>
            Criar
          </button>
          <button type="button" className="secondary small" onClick={() => setCreating(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <div className="inline">
          <select id="categoryId" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {canCreate && !disabled && (
            <button type="button" className="secondary small" onClick={() => setCreating(true)}>
              Nova
            </button>
          )}
        </div>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  )
}
