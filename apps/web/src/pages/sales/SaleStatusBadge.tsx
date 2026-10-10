import type { SaleStatus } from '@mini-erp/contracts'

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return (
    <span className={`badge ${status === 'COMPLETED' ? 'badge-ok' : 'badge-off'}`}>
      {status === 'COMPLETED' ? 'Concluída' : 'Cancelada'}
    </span>
  )
}
