import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // Porta fixa: se estiver ocupada, falha com erro claro em vez de pular para outra.
    port: 5180,
    strictPort: true,
    // Em dev, o front chama /api e o Vite repassa para o Nest.
    // O navegador vê uma única origem: sem dor de cabeça com CORS e cookies,
    // e o mesmo caminho relativo funciona em produção atrás de um proxy reverso.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
