/**
 * CertVoice — Main Application Router
 *
 * Routes:
 *   /                    — Public landing page (SEO, conversion)
 *   /sign-in             — Clerk sign-in (public)
 *   /sign-up             — Clerk sign-up (public)
 *   /dashboard           — Dashboard (Home) (protected)
 *   /new                 — Start new certificate (protected)
 *   /inspect/:id         — EICR capture workflow (protected)
 *   /minor-works/:id     — Minor Works capture workflow (protected)
 *   /eic/:id             — EIC capture workflow (protected)
 *   /certificates        — All completed certificates (protected)
 *   /settings            — Engineer profile, instruments, signature (protected)
 *   /subscription        — Stripe billing management (protected)
 *   *                    — 404 Not Found
 *
 * Auth: Clerk provider in main.tsx, routes protected via ProtectedRoute.
 * Monitoring: Sentry wraps Routes for performance tracking.
 *
 * Performance: LandingPage is eager-loaded (it's the public LCP target).
 * All other routes are code-split via React.lazy() so first-paint on
 * `/` only ships the landing bundle, not the full app.
 *
 * @module App
 */
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import * as Sentry from '@sentry/react'

// --- Eager imports (landing page + always-mounted chrome) ---
import LandingPage from './pages/LandingPage'
import BottomNav from './components/BottomNav'
import ProtectedRoute from './components/ProtectedRoute'
import HelpGuide from './components/HelpGuide'

// --- Lazy-loaded routes (split into separate chunks) ---
const Home = lazy(() => import('./pages/Home'))
const NewInspection = lazy(() => import('./pages/NewInspection'))
const InspectionCapture = lazy(() => import('./pages/InspectionCapture'))
const MinorWorksCapture = lazy(() => import('./pages/MinorWorksCapture'))
const EICCapture = lazy(() => import('./pages/EICCapture'))
const Certificates = lazy(() => import('./pages/Certificates'))
const Settings = lazy(() => import('./pages/Settings'))
const Subscription = lazy(() => import('./pages/Subscription'))
const AuthPage = lazy(() => import('./pages/AuthPage'))
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'))
const TermsOfService = lazy(() => import('./pages/TermsOfService'))
const NiceicExport = lazy(() => import('@/pages/NiceicExport'))
const NapitExport = lazy(() => import('@/pages/NapitExport'))

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
          Back to Home
        </Link>
      </div>
    </div>
  )
}

// ============================================================
// Suspense fallback — minimal, matches dark theme
// ============================================================
function RouteLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-certvoice-bg">
      <div className="text-certvoice-muted text-sm">Loading…</div>
    </div>
  )
}

// ============================================================
// APP ROOT
// ============================================================
export default function App() {
  return (
    <BrowserRouter>
      {/* Main content area — bottom padding clears the fixed nav */}
      <div className="pb-20">
        <Suspense fallback={<RouteLoader />}>
          <SentryRoutes>
            {/* Public routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/sign-in/*" element={<AuthPage mode="sign-in" />} />
            <Route path="/sign-up/*" element={<AuthPage mode="sign-up" />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            {/* Protected routes */}
            <Route path="/dashboard" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/new" element={<ProtectedRoute><NewInspection /></ProtectedRoute>} />
            <Route path="/inspect/:id" element={<ProtectedRoute><InspectionCapture /></ProtectedRoute>} />
            <Route path="/minor-works/:id" element={<ProtectedRoute><MinorWorksCapture /></ProtectedRoute>} />
            <Route path="/eic/:id" element={<ProtectedRoute><EICCapture /></ProtectedRoute>} />
            <Route path="/certificates" element={<ProtectedRoute><Certificates /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/subscription" element={<ProtectedRoute><Subscription /></ProtectedRoute>} />
            <Route path="/export/niceic/:certType/:id" element={<NiceicExport />} />
            <Route path="/export/napit/:certType/:id" element={<NapitExport />} />
            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </SentryRoutes>
        </Suspense>
      </div>
      {/* Floating help button — context-aware instructions per page */}
      <HelpGuide />
      {/* Fixed bottom navigation — auto-hides on public + auth pages */}
      <BottomNav />
    </BrowserRouter>
  )
}
