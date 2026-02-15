/**
 * CertVoice — Application Entry Point
 *
 * Initialises:
 *   - Sentry error tracking (before anything else)
 *   - React strict mode
 *   - HelmetProvider for SEO
 *   - ClerkProvider for authentication
 *   - App root with error boundary
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { HelmetProvider } from 'react-helmet-async'
import { ClerkProvider } from '@clerk/clerk-react'
import { initializeSentry } from './utils/errorTracking'
import App from './App'
import './index.css'

// --- Initialise Sentry FIRST (captures all subsequent errors) ---
initializeSentry()

// --- Clerk publishable key (public, safe for frontend) ---
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set. Add it to your Railway environment variables.')
}

// --- Error Boundary Fallback ---
function ErrorFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-certvoice-bg">
      <div className="cv-panel text-center space-y-4 max-w-sm">
        <div className="w-12 h-12 bg-certvoice-red rounded-lg flex items-center justify-center mx-auto text-2xl">
          ⚠
        </div>
        <h1 className="text-lg font-bold text-certvoice-text">
          Something went wrong
        </h1>
        <p className="text-sm text-certvoice-muted">
          An unexpected error occurred. Please refresh the page to continue.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="cv-btn-primary"
        >
          Refresh Page
        </button>
      </div>
    </div>
  )
}

// --- Mount App ---
const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found. Check index.html has a div with id="root".')
}

createRoot(rootElement).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
        <HelmetProvider>
          <App />
        </HelmetProvider>
      </ClerkProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>
)
