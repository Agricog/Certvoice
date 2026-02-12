import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },

  server: {
    port: 3000,
    strictPort: true,
    host: true,
  },

  preview: {
    port: 3000,
    strictPort: true,
    host: true,
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['lucide-react', 'react-helmet-async'],
          security: ['dompurify', '@sentry/react'],
          auth: ['@clerk/clerk-react'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },

  // Environment variable prefix — only VITE_ prefixed vars exposed to client
  envPrefix: 'VITE_',
})
