import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  centsToInput,
  createProductSchema,
  isFractionalUnit,
  parseBrlToCents,
  UNIT_KEYS,
  UNITS,
  updateProductSchema,
  type Product,
  type Unit,
} from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { ApiError } from '../../lib/api.ts'
import {
  useCreateProduct,
  useProduct,
  useSetProductStatus,
  useUpdateProduct,
} from '../../lib/catalog-queries.ts'
import { CategoryField } from './CategoryField.tsx'

/** O formulário trabalha com TEXTO (o que o usuário digita); a conversão acontece no envio. */
interface FormValues {
  sku: string
  name: string
  description: string
  unit: Unit
  barcode: string
  categoryId: string
  price: string
  minStock: string
}

type FieldErrors = Partial<Record<keyof FormValues, string>>

const EMPTY: FormValues = {
  sku: '',
  name: '',
  description: '',
  unit: 'UN',
  barcode: '',
  categoryId: '',
  price: '',
  minStock: '0',
}

function toFormValues(p: Product): FormValues {
  return {
    sku: p.sku,
    name: p.name,
    description: p.description,
    unit: p.unit,
    barcode: p.barcode ?? '',
    categoryId: p.category?.id ?? '',
    price: centsToInput(p.salePriceCents),
    minStock: String(p.minStock).replace('.', ','),
  }
}

/** Erros vindos do schema ou da API usam o nome do campo no contrato; aqui viram campos do form. */
const API_FIELD_TO_FORM: Record<string, keyof FormValues> = { salePriceCents: 'price' }
const toFormField = (path: string) => (API_FIELD_TO_FORM[path] ?? path) as keyof FormValues

export function ProductFormPage() {
  const { id } = useParams()
  const product = useProduct(id)

  if (id === undefined) return <ProductForm key="new" />
  if (product.isPending) return <p className="muted">Carregando…</p>
  if (product.isError) {
    return (
      <section className="empty">
        <h1>{product.error instanceof ApiError && product.error.status === 404 ? 'Produto não encontrado' : 'Erro ao carregar'}</h1>
        <Link to="/produtos">Voltar para produtos</Link>
      </section>
    )
  }
  // key com a versão: ao recarregar após um conflito, o formulário remonta com os dados novos.
  return <ProductForm key={`${product.data.id}:${product.data.version}`} product={product.data} onReload={() => void product.refetch()} />
}

function ProductForm({ product, onReload }: { product?: Product; onReload?: () => void }) {
  const { can } = useAuth()
  const navigate = useNavigate()
  const editable = can('produtos:gerenciar')
  const isNew = product === undefined

  const [values, setValues] = useState<FormValues>(product ? toFormValues(product) : EMPTY)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const create = useCreateProduct()
  const update = useUpdateProduct(product?.id ?? '')
  const setStatus = useSetProductStatus(product?.id ?? '')
  const saving = create.isPending || update.isPending

  const set = (field: keyof FormValues) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    const salePriceCents = parseBrlToCents(values.price)
    if (salePriceCents === null) {
      setErrors({ price: 'Preço inválido. Use o formato 19,90' })
      return
    }

    const payload = {
      sku: values.sku,
      name: values.name,
      description: values.description,
      unit: values.unit,
      barcode: values.barcode,
      categoryId: values.categoryId,
      salePriceCents,
      minStock: Number(values.minStock.replace(',', '.')),
      ...(product && { version: product.version }),
    }

    // Mesmo schema da API: os erros aparecem antes de qualquer requisição.
    const parsed = (isNew ? createProductSchema : updateProductSchema).safeParse(payload)
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const field = toFormField(String(issue.path[0]))
        next[field] ??= issue.message
      }
      setErrors(next)
      return
    }

    try {
      if (isNew) {
        const created = await create.mutateAsync(createProductSchema.parse(payload))
        navigate(`/produtos/${created.id}`, { replace: true })
      } else {
        await update.mutateAsync(updateProductSchema.parse(payload))
        navigate('/produtos')
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setConflict(true)
      } else if (err instanceof ApiError && err.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(err.fieldErrors.map((e) => [toFormField(e.path), e.message])))
      } else {
        setFormError(err instanceof Error ? err.message : 'Erro inesperado')
      }
    }
  }

  async function toggleArchive() {
    if (!product) return
    try {
      await setStatus.mutateAsync(product.status === 'ACTIVE' ? 'archive' : 'unarchive')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  const fractional = isFractionalUnit(values.unit)
  const disabled = !editable || saving

  return (
    <section className="narrow">
      <div className="row">
        <h1>{isNew ? 'Novo produto' : product.name}</h1>
        {product && (
          <div className="actions">
            <span className={`badge ${product.status === 'ACTIVE' ? 'badge-ok' : 'badge-off'}`}>
              {product.status === 'ACTIVE' ? 'Ativo' : 'Arquivado'}
            </span>
            {can('estoque:ler') && (
              <Link to={`/estoque/${product.id}`} className="button secondary small">
                Ver estoque
              </Link>
            )}
          </div>
        )}
      </div>

      {conflict && (
        <div className="banner" role="alert">
          <p>
            Outra pessoa alterou este produto enquanto você editava. Para não sobrescrever a alteração
            dela, recarregue e refaça a sua.
          </p>
          <button type="button" className="small" onClick={onReload}>
            Recarregar versão atual
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="product-form">
        <Field label="SKU" error={errors.sku}>
          <input value={values.sku} onChange={(e) => set('sku')(e.target.value)} disabled={disabled} className="mono" />
        </Field>
        <Field label="Nome" error={errors.name}>
          <input value={values.name} onChange={(e) => set('name')(e.target.value)} disabled={disabled} />
        </Field>
        <Field label="Descrição" error={errors.description} wide>
          <textarea
            rows={3}
            value={values.description}
            onChange={(e) => set('description')(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Unidade" error={errors.unit}>
          <select value={values.unit} onChange={(e) => set('unit')(e.target.value)} disabled={disabled}>
            {UNIT_KEYS.map((u) => (
              <option key={u} value={u}>
                {u} · {UNITS[u]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Código de barras (EAN)" error={errors.barcode}>
          <input
            inputMode="numeric"
            value={values.barcode}
            onChange={(e) => set('barcode')(e.target.value)}
            disabled={disabled}
            className="mono"
          />
        </Field>
        <Field label="Preço de venda (R$)" error={errors.price}>
          <input
            inputMode="decimal"
            placeholder="19,90"
            value={values.price}
            onChange={(e) => set('price')(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label={`Estoque mínimo (${values.unit})`} error={errors.minStock}>
          <input
            inputMode={fractional ? 'decimal' : 'numeric'}
            value={values.minStock}
            onChange={(e) => set('minStock')(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <CategoryField
          value={values.categoryId}
          onChange={set('categoryId')}
          disabled={disabled}
          canCreate={editable}
        />
        {errors.categoryId && <span className="field-error">{errors.categoryId}</span>}

        {formError && (
          <p className="error wide" role="alert">
            {formError}
          </p>
        )}

        <div className="actions wide">
          <Link to="/produtos" className="button secondary">
            {editable ? 'Cancelar' : 'Voltar'}
          </Link>
          {editable && product && (
            <button type="button" className="secondary" onClick={() => void toggleArchive()} disabled={setStatus.isPending}>
              {product.status === 'ACTIVE' ? 'Arquivar' : 'Reativar'}
            </button>
          )}
          {editable && (
            <button type="submit" disabled={saving || conflict}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

function Field({
  label,
  error,
  wide,
  children,
}: {
  label: string
  error?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      {label}
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  )
}
