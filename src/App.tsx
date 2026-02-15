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

// --- Page imports ---
import Home from './pages/Home'
import NewInspection from './pages/NewInspection'
import InspectionCapture from './pages/InspectionCapture'
import Certificates from './pages/Certificates'
import Settings from './pages/Settings'
import Subscription from './pages/Subscription'

// --- Sentry-wrapped Routes for performance monitoring ---
const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes)

// ============================================================
// 404
// ============================================================

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
// APP ROOT
// ============================================================

export default function App() {
  return (
    <BrowserRouter>
      <SentryRoutes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewInspection />} />
        <Route path="/inspect/:id" element={<InspectionCapture />} />
        <Route path="/certificates" element={<Certificates />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/subscription" element={<Subscription />} />
        <Route path="*" element={<NotFound />} />
      </SentryRoutes>
    </BrowserRouter>
  )
}
