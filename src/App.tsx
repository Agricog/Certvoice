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
 * @module App
 */
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import * as Sentry from '@sentry/react'
// --- Page imports ---
import LandingPage from './pages/LandingPage'
import Home from './pages/Home'
import NewInspection from './pages/NewInspection'
import InspectionCapture from './pages/InspectionCapture'
import MinorWorksCapture from './pages/MinorWorksCapture'
import EICCapture from './pages/EICCapture'
import Certificates from './pages/Certificates'
import Settings from './pages/Settings'
import Subscription from './pages/Subscription'
import AuthPage from './pages/AuthPage'
import PrivacyPolicy from './pages/PrivacyPolicy'
import TermsOfService from './pages/TermsOfService'
import NiceicExport from '@/pages/NiceicExport'
import NapitExport from '@/pages/NapitExport'
// --- Component imports ---
import BottomNav from './components/BottomNav'
import ProtectedRoute from './components/ProtectedRoute'
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
// APP ROOT
// ============================================================
export default function App() {
  return (
    <BrowserRouter>
      {/* Main content area — bottom padding clears the fixed nav */}
      <div className="pb-20">
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
      </div>
      {/* Fixed bottom navigation — auto-hides on public + auth pages */}
      <BottomNav />
    </BrowserRouter>
  )
}
