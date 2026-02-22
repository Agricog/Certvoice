import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Keep existing public/manifest.json — don't generate a new one
      manifest: false,
      workbox: {
        // Precache all built assets (JS, CSS, HTML, fonts, images)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}'],
        // SPA fallback — serve index.html for all navigation requests
        navigateFallback: '/index.html',
        // Don't intercept Clerk auth or API routes
        navigateFallbackDenylist: [/^\/api\//, /^\/__clerk/],
        // Runtime caching for external resources
        runtimeCaching: [
          // Google Fonts stylesheets — check for updates but serve cached
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // Google Fonts webfont files — cache long-term
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Clerk resources — network only, never cache auth
          {
            urlPattern: /^https:\/\/.*\.clerk\..*/i,
            handler: 'NetworkOnly',
          },
          // Sentry — network only
          {
            urlPattern: /^https:\/\/.*\.sentry\.io\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
        // Don't precache source maps
        globIgnores: ['**/*.map'],
      },
      // Dev options — disable in dev to avoid confusion
      devOptions: {
        enabled: false,
      },
    }),
  ],
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
    minify: 'esbuild',
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
  esbuild: {
    drop: ['console', 'debugger'],
  },
  // Environment variable prefix — only VITE_ prefixed vars exposed to client
  envPrefix: 'VITE_',
})
