import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from './auth/auth-context.ts'
import { Layout } from './components/Layout.tsx'
import { RequirePermission } from './components/RequirePermission.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { CashDetailPage, CashHistoryPage } from './pages/cash/CashHistoryPage.tsx'
import { CashPage } from './pages/cash/CashPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { ReportsPage } from './pages/reports/ReportsPage.tsx'
import { CategoriesPage } from './pages/products/CategoriesPage.tsx'
import { ProductFormPage } from './pages/products/ProductFormPage.tsx'
import { ProductListPage } from './pages/products/ProductListPage.tsx'
import { PosPage } from './pages/sales/PosPage.tsx'
import { ReceiptPage } from './pages/sales/ReceiptPage.tsx'
import { SaleDetailPage } from './pages/sales/SaleDetailPage.tsx'
import { SalesListPage } from './pages/sales/SalesListPage.tsx'
import { StockPage } from './pages/stock/StockPage.tsx'
import { SuppliersPage } from './pages/suppliers/SuppliersPage.tsx'
import { UsersPage } from './pages/users/UsersPage.tsx'

export default function App() {
  const { me, can } = useAuth()

  if (me === undefined) return <p className="page muted">Carregando…</p>
  if (!me) return <LoginPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Cada perfil cai na tela que mais usa: quem vende vai direto ao caixa. */}
        <Route index element={<Navigate to={can('vendas:criar') ? '/vendas/nova' : '/produtos'} replace />} />
        <Route
          path="produtos"
          element={
            <RequirePermission permission="produtos:ler">
              <ProductListPage />
            </RequirePermission>
          }
        />
        <Route
          path="produtos/novo"
          element={
            <RequirePermission permission="produtos:gerenciar">
              <ProductFormPage />
            </RequirePermission>
          }
        />
        <Route
          path="produtos/categorias"
          element={
            <RequirePermission permission="produtos:ler">
              <CategoriesPage />
            </RequirePermission>
          }
        />
        <Route
          path="produtos/:id"
          element={
            <RequirePermission permission="produtos:ler">
              <ProductFormPage />
            </RequirePermission>
          }
        />
        <Route
          path="estoque/:productId"
          element={
            <RequirePermission permission="estoque:ler">
              <StockPage />
            </RequirePermission>
          }
        />
        <Route
          path="vendas"
          element={
            <RequirePermission permission="vendas:ler">
              <SalesListPage />
            </RequirePermission>
          }
        />
        <Route
          path="vendas/nova"
          element={
            <RequirePermission permission="vendas:criar">
              <PosPage />
            </RequirePermission>
          }
        />
        <Route
          path="vendas/:id"
          element={
            <RequirePermission permission="vendas:ler">
              <SaleDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="vendas/:id/cupom"
          element={
            <RequirePermission permission="vendas:ler">
              <ReceiptPage />
            </RequirePermission>
          }
        />
        <Route
          path="caixa"
          element={
            <RequirePermission permission="caixa:operar">
              <CashPage />
            </RequirePermission>
          }
        />
        <Route
          path="caixa/historico"
          element={
            <RequirePermission permission="caixa:gerenciar">
              <CashHistoryPage />
            </RequirePermission>
          }
        />
        <Route
          path="caixa/:id"
          element={
            <RequirePermission permission="caixa:operar">
              <CashDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="fornecedores"
          element={
            <RequirePermission permission="fornecedores:ler">
              <SuppliersPage />
            </RequirePermission>
          }
        />
        <Route
          path="relatorios"
          element={
            <RequirePermission permission="relatorios:ler">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="usuarios"
          element={
            <RequirePermission permission="usuarios:gerenciar">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route path="meu-acesso" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
