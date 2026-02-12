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

// --- Sentry-wrapped Routes for performance monitoring ---
const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes)

// ============================================================
// PLACEHOLDER PAGES
// These will be replaced with full implementations in Phase 3+
// ============================================================

function Home() {
  return (
    <div className="min-h-screen bg-certvoice-bg">
      <Helmet>
        <title>CertVoice — Voice-First EICR Certificates for UK Electricians</title>
        <meta
          name="description"
          content="Complete EICR certificates by voice. Speak your inspection findings, get BS 7671-compliant PDFs. No typing, no desktop software needed."
        />
      </Helmet>

      {/* Header */}
      <header className="border-b border-certvoice-border bg-certvoice-surface sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-certvoice-accent rounded-lg flex items-center justify-center text-base">
              🎤
            </div>
            <span className="font-bold text-lg tracking-tight text-certvoice-text">
              CertVoice
            </span>
          </div>
          <span className="cv-badge-pass">Phase 1 Complete</span>
        </div>
      </header>

      {/* Dashboard */}
      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Quick Actions */}
        <div className="cv-panel space-y-3">
          <h2 className="cv-section-title">Quick Actions</h2>
          <Link
            to="/new"
            className="cv-btn-primary w-full flex items-center justify-center gap-2"
          >
            🎤 New EICR Inspection
          </Link>
          <Link
            to="/certificates"
            className="cv-btn-secondary w-full flex items-center justify-center gap-2"
          >
            📋 View Certificates
          </Link>
        </div>

        {/* Status Card */}
        <div className="cv-panel space-y-3">
          <h2 className="cv-section-title">Build Status</h2>
          <div className="grid grid-cols-2 gap-3">
            <StatusItem label="Foundation" status="complete" />
            <StatusItem label="Types" status="complete" />
            <StatusItem label="Utilities" status="complete" />
            <StatusItem label="Router" status="complete" />
            <StatusItem label="Voice Capture" status="next" />
            <StatusItem label="AI Extraction" status="next" />
            <StatusItem label="Certificate Assembly" status="pending" />
            <StatusItem label="PDF Output" status="pending" />
          </div>
        </div>

        {/* Navigation Links */}
        <div className="cv-panel space-y-3">
          <h2 className="cv-section-title">Navigation</h2>
          <nav className="space-y-2">
            <NavLink to="/new" label="New Inspection" description="Start a new EICR" />
            <NavLink to="/certificates" label="Certificates" description="View all certificates" />
            <NavLink to="/settings" label="Settings" description="Profile, instruments, signature" />
            <NavLink to="/subscription" label="Subscription" description="Billing management" />
          </nav>
        </div>
      </main>
    </div>
  )
}

function NewInspection() {
  return (
    <PageShell title="New EICR Inspection" subtitle="Sections A-D: Client details, installation details, extent and limitations">
      <p className="text-certvoice-muted text-sm">
        This page will capture Sections A-D of the EICR: client details, reason for report,
        installation details, and extent/limitations. Coming in Phase 3.
      </p>
    </PageShell>
  )
}

function InspectionCapture() {
  return (
    <PageShell title="Inspection Capture" subtitle="Voice capture, checklist, and photo evidence">
      <p className="text-certvoice-muted text-sm">
        The main capture workflow with voice recording, AI extraction, inspection checklist,
        and photo evidence. Coming in Phase 2-3.
      </p>
    </PageShell>
  )
}

function CertificateList() {
  return (
    <PageShell title="Certificates" subtitle="All completed EICR certificates">
      <p className="text-certvoice-muted text-sm">
        Search, filter, and manage all certificates. Download PDFs, share via email.
        Coming in Phase 3.
      </p>
    </PageShell>
  )
}

function Settings() {
  return (
    <PageShell title="Settings" subtitle="Engineer profile, company details, instruments, digital signature">
      <p className="text-certvoice-muted text-sm">
        Pre-fill data for certificates: your name, company, registration number,
        test instruments, and digital signature. Coming in Phase 5.
      </p>
    </PageShell>
  )
}

function Subscription() {
  return (
    <PageShell title="Subscription" subtitle="Stripe billing management">
      <p className="text-certvoice-muted text-sm">
        Manage your CertVoice subscription. Plans start from £25/month.
        Coming in Phase 5.
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

function StatusItem({
  label,
  status,
}: {
  label: string
  status: 'complete' | 'next' | 'pending'
}) {
  const styles = {
    complete: 'cv-badge-pass',
    next: 'cv-badge-warning',
    pending: 'cv-badge bg-certvoice-surface-2 text-certvoice-muted',
  }
  const icons = {
    complete: '✓',
    next: '→',
    pending: '·',
  }

  return (
    <div className="cv-data-field flex items-center justify-between">
      <span className="text-xs text-certvoice-text">{label}</span>
      <span className={styles[status]}>{icons[status]}</span>
    </div>
  )
}

function NavLink({
  to,
  label,
  description,
}: {
  to: string
  label: string
  description: string
}) {
  return (
    <Link
      to={to}
      className="block cv-data-field hover:border-certvoice-accent transition-colors"
    >
      <div className="text-sm font-medium text-certvoice-text">{label}</div>
      <div className="text-xs text-certvoice-muted">{description}</div>
    </Link>
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
