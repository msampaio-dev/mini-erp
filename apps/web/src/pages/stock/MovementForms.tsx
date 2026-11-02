import { useState, type FormEvent } from 'react'
import {
  ADJUSTMENT_REASONS,
  createAdjustmentSchema,
  createEntrySchema,
  isFractionalUnit,
  parseBrlToCents,
  type AdjustmentReason,
  type Product,
} from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { ApiError } from '../../lib/api.ts'
import { useRegisterAdjustment, useRegisterEntry } from '../../lib/inventory-queries.ts'
import { useSuppliers } from '../../lib/suppliers-queries.ts'
import { parseQuantity } from '../../lib/quantity.ts'
import { useIdempotencyKey } from '../../lib/use-idempotency-key.ts'

type Errors = Record<string, string | undefined>

function errorsFrom(err: unknown): { fields: Errors; form: string | null } {
  if (err instanceof ApiError && err.fieldErrors.length > 0) {
    return { fields: Object.fromEntries(err.fieldErrors.map((e) => [e.path, e.message])), form: null }
  }
  return { fields: {}, form: err instanceof Error ? err.message : 'Erro inesperado' }
}

interface FormProps {
  product: Product
  onDone: () => void
}

export function EntryForm({ product, onDone }: FormProps) {
  const [key, renewKey] = useIdempotencyKey()
  const register = useRegisterEntry()
  const [quantity, setQuantity] = useState('')
  const [cost, setCost] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const { can } = useAuth()
  // Lista dos ativos para escolher; um mercado pequeno tem dezenas, não milhares (ADR 0021).
  const suppliers = useSuppliers('', 'true', 1, can('fornecedores:ler'))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const qty = parseQuantity(quantity)
    const unitCostCents = parseBrlToCents(cost)
    if (qty === null || unitCostCents === null) {
      setErrors({
        quantity: qty === null ? 'Quantidade inválida' : undefined,
        unitCostCents: unitCostCents === null ? 'Custo inválido. Use o formato 2,50' : undefined,
      })
      return
    }
    const parsed = createEntrySchema.safeParse({
      productId: product.id,
      quantity: qty,
      unitCostCents,
      supplierId,
      invoiceNumber,
      note,
    })
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    try {
      await register.mutateAsync({ input: parsed.data, key })
      renewKey()
      onDone()
    } catch (err) {
      const { fields, form } = errorsFrom(err)
      setErrors(fields)
      setFormError(form)
    }
  }

  return (
    <form className="panel movement-form" onSubmit={onSubmit} noValidate>
      <h2>Registrar entrada</h2>
      <label>
        Quantidade ({product.unit})
        <input
          autoFocus
          inputMode={isFractionalUnit(product.unit) ? 'decimal' : 'numeric'}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        {errors.quantity && <span className="field-error">{errors.quantity}</span>}
      </label>
      <label>
        Custo unitário (R$)
        <input inputMode="decimal" placeholder="2,50" value={cost} onChange={(e) => setCost(e.target.value)} />
        {errors.unitCostCents && <span className="field-error">{errors.unitCostCents}</span>}
      </label>
      {suppliers.data && (
        <label>
          Fornecedor
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Sem fornecedor</option>
            {suppliers.data.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {errors.supplierId && <span className="field-error">{errors.supplierId}</span>}
        </label>
      )}
      <label>
        Nota fiscal do fornecedor
        <input value={invoiceNumber} placeholder="NF 4471" onChange={(e) => setInvoiceNumber(e.target.value)} />
      </label>
      <label className="wide">
        Observação
        <input value={note} onChange={(e) => setNote(e.target.value)} />
        {errors.note && <span className="field-error">{errors.note}</span>}
      </label>
      {formError && <p className="error wide" role="alert">{formError}</p>}
      <div className="actions wide">
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        {/* disabled durante o envio + Idempotency-Key: dupla proteção contra lançamento duplicado */}
        <button type="submit" disabled={register.isPending}>
          {register.isPending ? 'Registrando…' : 'Registrar entrada'}
        </button>
      </div>
    </form>
  )
}

export function AdjustmentForm({ product, onDone }: FormProps) {
  const [key, renewKey] = useIdempotencyKey()
  const register = useRegisterAdjustment()
  const [direction, setDirection] = useState<'out' | 'in'>('out')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<AdjustmentReason>('AVARIA')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const qty = parseQuantity(quantity)
    if (qty === null || qty <= 0) {
      setErrors({ quantity: 'Informe uma quantidade positiva' })
      return
    }
    const parsed = createAdjustmentSchema.safeParse({
      productId: product.id,
      quantity: direction === 'out' ? -qty : qty,
      reason,
      note,
    })
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    try {
      await register.mutateAsync({ input: parsed.data, key })
      renewKey()
      onDone()
    } catch (err) {
      const { fields, form } = errorsFrom(err)
      setErrors(fields)
      setFormError(form)
    }
  }

  return (
    <form className="panel movement-form" onSubmit={onSubmit} noValidate>
      <h2>Ajustar estoque</h2>
      <label>
        Tipo
        <select value={direction} onChange={(e) => setDirection(e.target.value as 'out' | 'in')}>
          <option value="out">Saída (faltou)</option>
          <option value="in">Entrada (sobrou)</option>
        </select>
      </label>
      <label>
        Quantidade ({product.unit})
        <input
          autoFocus
          inputMode={isFractionalUnit(product.unit) ? 'decimal' : 'numeric'}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        {errors.quantity && <span className="field-error">{errors.quantity}</span>}
      </label>
      <label>
        Motivo
        <select value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)}>
          {Object.entries(ADJUSTMENT_REASONS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Observação{reason === 'OUTRO' ? ' (obrigatória)' : ''}
        <input value={note} onChange={(e) => setNote(e.target.value)} />
        {errors.note && <span className="field-error">{errors.note}</span>}
      </label>
      {formError && <p className="error wide" role="alert">{formError}</p>}
      <div className="actions wide">
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" disabled={register.isPending}>
          {register.isPending ? 'Registrando…' : 'Registrar ajuste'}
        </button>
      </div>
    </form>
  )
}
