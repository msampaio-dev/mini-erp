import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { formatCents, PRODUCT_STATUSES, type ProductStatus } from '@mini-erp/contracts'
import { useAuth } from '../../auth/auth-context.ts'
import { useProducts, type ProductListParams } from '../../lib/catalog-queries.ts'
import { useBalances } from '../../lib/inventory-queries.ts'
import { formatQuantity } from '../../lib/quantity.ts'
import { useDebouncedValue } from '../../lib/use-debounced-value.ts'

const PAGE_SIZE = 20
const STATUS_LABEL: Record<ProductStatus | 'ALL', string> = {
  ACTIVE: 'Ativos',
  ARCHIVED: 'Arquivados',
  ALL: 'Todos',
}

function readStatus(value: string | null): ProductListParams['status'] {
  return value === 'ALL' || PRODUCT_STATUSES.includes(value as ProductStatus)
    ? (value as ProductListParams['status'])
    : 'ACTIVE'
}

export function ProductListPage() {
  const { can } = useAuth()
  // Filtros vivem na URL: link compartilhável e o "voltar" do navegador funciona.
  const [searchParams, setSearchParams] = useSearchParams()
  const params: ProductListParams = {
    q: searchParams.get('q') ?? undefined,
    status: readStatus(searchParams.get('status')),
    page: Math.max(1, Number(searchParams.get('page')) || 1),
    pageSize: PAGE_SIZE,
  }

  function update(changes: Partial<Record<'q' | 'status' | 'page', string>>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )
  }

  // O campo responde a cada tecla; a busca só dispara após 300ms de pausa.
  const [search, setSearch] = useState(params.q ?? '')
  const debouncedSearch = useDebouncedValue(search.trim())
  useEffect(() => {
    if (debouncedSearch !== (params.q ?? '')) update({ q: debouncedSearch, page: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage só à busca digitada
  }, [debouncedSearch])

  const { data, isPending, isError, error, isPlaceholderData } = useProducts(params)
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  // Saldo vem de outro módulo (Estoque): uma requisição para a página inteira, não uma por linha.
  const showStock = can('estoque:ler')
  const { data: balances } = useBalances(data?.items.map((p) => p.id) ?? [], showStock)
  const balanceOf = new Map(balances?.map((b) => [b.productId, b.quantity]))
  const columns = showStock ? 7 : 6

  return (
    <section>
      <div className="row">
        <h1>Produtos</h1>
        <div className="actions">
          <Link to="/produtos/categorias" className="button secondary">
            Categorias
          </Link>
          {can('produtos:gerenciar') && (
            <Link to="/produtos/novo" className="button">
              Novo produto
            </Link>
          )}
        </div>
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="Buscar por nome, SKU ou código de barras"
          aria-label="Buscar produtos"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Situação"
          value={params.status}
          onChange={(e) => update({ status: e.target.value === 'ACTIVE' ? '' : e.target.value, page: '' })}
        >
          {(['ACTIVE', 'ARCHIVED', 'ALL'] as const).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {isPending && <p className="muted">Carregando…</p>}
      {isError && <p className="error">Não foi possível carregar: {error.message}</p>}

      {data && (
        <>
          <div className={`table-wrap${isPlaceholderData ? ' loading' : ''}`}>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nome</th>
                  <th>Categoria</th>
                  <th>Un.</th>
                  <th className="num">Preço</th>
                  {showStock && <th className="num">Saldo</th>}
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.sku}</td>
                    <td>
                      <Link to={`/produtos/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.category?.name ?? '—'}</td>
                    <td>{p.unit}</td>
                    <td className="num">{formatCents(p.salePriceCents)}</td>
                    {showStock && (
                      <StockCell quantity={balanceOf.get(p.id)} minStock={p.minStock} productId={p.id} />
                    )}
                    <td>
                      <span className={`badge ${p.status === 'ACTIVE' ? 'badge-ok' : 'badge-off'}`}>
                        {p.status === 'ACTIVE' ? 'Ativo' : 'Arquivado'}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={columns} className="muted center">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <nav className="pagination" aria-label="Paginação">
            <button
              type="button"
              className="secondary small"
              disabled={params.page <= 1}
              onClick={() => update({ page: String(params.page - 1) })}
            >
              Anterior
            </button>
            <span className="muted">
              Página {params.page} de {totalPages} · {data.total} produto(s)
            </span>
            <button
              type="button"
              className="secondary small"
              disabled={params.page >= totalPages}
              onClick={() => update({ page: String(params.page + 1) })}
            >
              Próxima
            </button>
          </nav>
        </>
      )}
    </section>
  )
}

function StockCell({ quantity, minStock, productId }: { quantity?: number; minStock: number; productId: string }) {
  if (quantity === undefined) return <td className="num muted">…</td>
  const below = minStock > 0 && quantity < minStock
  return (
    <td className={`num${below ? ' down' : ''}`} title={below ? 'Abaixo do estoque mínimo' : undefined}>
      <Link to={`/estoque/${productId}`}>{formatQuantity(quantity)}</Link>
      {below && ' ⚠'}
    </td>
  )
}
