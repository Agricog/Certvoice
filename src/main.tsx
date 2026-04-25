/**
 * CertVoice — Application Entry Point
 *
 * Initialises:
 *   - React strict mode
 *   - HelmetProvider for SEO
 *   - ClerkProvider for authentication
 *   - App root with error boundary
 *   - Sentry error tracking (deferred until after first paint)
 *
 * Performance: Sentry init is deferred via requestIdleCallback so it
 * does not block the landing page's first contentful paint. Errors
 * thrown before Sentry initialises are still caught by the React
 * error boundary below — they just won't be reported to Sentry.
 */
import { StrictMode, Component, type ReactNode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import { ClerkProvider } from '@clerk/clerk-react'
import { initializeSentry } from './utils/errorTracking'
import App from './App'
import './index.css'

// --- Defer Sentry init until browser is idle (post first paint) ---
if (typeof window !== 'undefined') {
  const initSentry = () => {
    try {
      initializeSentry()
    } catch (err) {
      // Sentry init failure must never break the app
      console.error('Sentry init failed:', err)
    }
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(initSentry, { timeout: 3000 })
  } else {
    setTimeout(initSentry, 1)
  }
}

// --- Clerk publishable key (public, safe for frontend) ---
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string
if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set. Add it to your Railway environment variables.')
}

// --- Error Boundary Fallback UI ---
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

// --- Plain React Error Boundary ---
// Forwards caught errors to Sentry IF it has loaded, otherwise just logs.
// Replaces Sentry.ErrorBoundary so Sentry SDK code paths aren't required
// at initial render time.
interface ErrorBoundaryState {
  hasError: boolean
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Lazy-import Sentry to avoid pulling it into the critical path.
    // If Sentry init has already happened, the captured event will report.
    // If not, this dynamic import is harmless (errors are still logged).
    import('@sentry/react')
      .then((Sentry) => {
        Sentry.captureException(error, {
          contexts: { react: { componentStack: errorInfo.componentStack } },
        })
      })
      .catch(() => {
        // Sentry unavailable — fall back to console
        console.error('App error:', error, errorInfo)
      })
  }

  render() {
    if (this.state.hasError) return <ErrorFallback />
    return this.props.children
  }
}

// --- Mount App ---
const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found. Check index.html has a div with id="root".')
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
        <HelmetProvider>
          <App />
        </HelmetProvider>
      </ClerkProvider>
    </AppErrorBoundary>
  </StrictMode>
)
