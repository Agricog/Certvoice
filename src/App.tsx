/**
 * CertVoice — Main Application Router
 *
 * Routes:
 *   /                    — Dashboard (Home)
 *   /new                 — Start new EICR inspection
 *   /inspect/:id         — Main capture workflow
 *   /certificates        — All completed certificates
 *   /settings            — Engineer profile, instruments, signature
 *   /subscription        — Stripe billing management
 *   *                    — 404 Not Found
 *
 * Auth: Clerk provider wraps all routes.
 * Monitoring: Sentry wraps Routes for performance tracking.
 */

import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { Helmet } from 'react-helmet-async'

// --- Page imports (real implementations) ---
import Home from './pages/Home'
import NewInspection from './pages/NewInspection'
import InspectionCapture from './pages/InspectionCapture'
import Settings from './pages/Settings'
import Subscription from './pages/Subscription'

// --- Sentry-wrapped Routes for performance monitoring ---
const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes)

// ============================================================
// PLACEHOLDER PAGES
// Certificates page — no dedicated file yet
// ============================================================

function CertificateList() {
  return (
    <PageShell title="Certificates" subtitle="All completed EICR certificates">
      <p className="text-certvoice-muted text-sm">
        Search, filter, and manage all certificates. Download PDFs, share via email.
        Coming soon.
      </p>
    </PageShell>
  )
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-certvoice-bg">
      <div className="cv-panel text-center space-y-4 max-w-sm">
        <div className="text-5xl font-mono font-bold text-certvoice-muted">404</div>
        <h1 className="text-lg font-bold text-certvoice-text">Page Not Found</h1>
        <p className="text-sm text-certvoice-muted">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link to="/" className="cv-btn-primary inline-block">
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}

// ============================================================
// SHARED COMPONENTS
// ============================================================

function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-certvoice-bg">
      <Helmet>
        <title>{title} — CertVoice</title>
      </Helmet>

      {/* Header */}
      <header className="border-b border-certvoice-border bg-certvoice-surface sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            to="/"
            className="text-certvoice-muted hover:text-certvoice-accent transition-colors text-sm"
          >
            ← Back
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-certvoice-accent rounded-md flex items-center justify-center text-sm">
              🎤
            </div>
            <span className="font-bold text-base tracking-tight text-certvoice-text">
              CertVoice
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="cv-panel space-y-3">
          <h1 className="text-lg font-bold text-certvoice-text">{title}</h1>
          <p className="text-xs text-certvoice-muted">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  )
}

// ============================================================
// APP ROOT
// ============================================================

export default function App() {
  return (
    <BrowserRouter>
      <SentryRoutes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewInspection />} />
        <Route path="/inspect/:id" element={<InspectionCapture />} />
        <Route path="/certificates" element={<CertificateList />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/subscription" element={<Subscription />} />
        <Route path="*" element={<NotFound />} />
      </SentryRoutes>
    </BrowserRouter>
  )
}
