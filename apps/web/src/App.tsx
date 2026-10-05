import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from './auth/auth-context.ts'
import { Layout } from './components/Layout.tsx'
import { RequirePermission } from './components/RequirePermission.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { ProductFormPage } from './pages/products/ProductFormPage.tsx'
import { ProductListPage } from './pages/products/ProductListPage.tsx'
import { StockPage } from './pages/stock/StockPage.tsx'

export default function App() {
  const { me } = useAuth()

  if (me === undefined) return <p className="page muted">Carregando…</p>
  if (!me) return <LoginPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/produtos" replace />} />
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
        <Route path="meu-acesso" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
