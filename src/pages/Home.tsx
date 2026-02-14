/**
 * CertVoice — Home Page (Dashboard)
 *
 * Shows recent certificates, jobs in progress, and quick actions.
 * Uses correct EICRCertificate type structure from eicr.ts.
 *
 * @module pages/Home
 */

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  Zap,
  Plus,
  FileText,
  Clock,
  CheckCircle2,
  ChevronRight,
  Search,
  Mic,
} from 'lucide-react'
import type {
  EICRCertificate,
  CertificateStatus,
  ClassificationCode,
} from '../types/eicr'
import { captureError } from '../utils/errorTracking'

// ============================================================
// TYPES
// ============================================================

type StatusFilter = 'ALL' | CertificateStatus

// ============================================================
// MOCK DATA (replace with API calls in Phase 6)
// ============================================================

const MOCK_CERTIFICATES: Partial<EICRCertificate>[] = [
  {
    id: 'cert-001',
    reportNumber: 'CV-LQ1R8K',
    status: 'IN_PROGRESS',
    clientDetails: {
      clientName: 'Mr J Smith',
      clientAddress: '42 Maple Drive, Truro TR1 3BQ',
    },
    installationDetails: {
      installationAddress: '42 Maple Drive, Truro TR1 3BQ',
      occupier: 'Mrs J Smith',
      premisesType: 'DOMESTIC',
      estimatedAgeOfWiring: 20,
      evidenceOfAdditions: true,
      additionsEstimatedAge: 5,
      installationRecordsAvailable: false,
      dateOfLastInspection: '2019-03-15',
    },
    reportReason: {
      purpose: 'PERIODIC',
      inspectionDates: ['2026-02-14'],
    },
    circuits: [],
    observations: [
      {
        itemNumber: 1,
        observationText: 'Supply tails not adequately supported',
        classificationCode: 'C2',
        dbReference: 'DB1',
        location: 'Main intake',
        regulationReference: 'Reg 522.8.5',
      },
    ],
    createdAt: '2026-02-14T09:30:00Z',
    updatedAt: '2026-02-14T14:22:00Z',
  },
  {
    id: 'cert-002',
    reportNumber: 'CV-KP9M3N',
    status: 'COMPLETED',
    clientDetails: {
      clientName: 'Acme Properties Ltd',
      clientAddress: '10 High Street, Falmouth TR11 2AF',
    },
    installationDetails: {
      installationAddress: '15 Beach Road, Falmouth TR11 4NX',
      occupier: 'Mr D Jones',
      premisesType: 'DOMESTIC',
      estimatedAgeOfWiring: 35,
      evidenceOfAdditions: false,
      additionsEstimatedAge: null,
      installationRecordsAvailable: true,
      dateOfLastInspection: '2021-06-10',
    },
    reportReason: {
      purpose: 'CHANGE_OF_OCCUPANCY',
      inspectionDates: ['2026-02-10'],
    },
    circuits: [],
    observations: [],
    createdAt: '2026-02-10T08:00:00Z',
    updatedAt: '2026-02-10T16:45:00Z',
  },
  {
    id: 'cert-003',
    reportNumber: 'CV-JN7X2P',
    status: 'DRAFT',
    clientDetails: {
      clientName: 'Cornwall Housing',
      clientAddress: '23 Lemon Street, Truro TR1 2LS',
    },
    installationDetails: {
      installationAddress: '8 Trelawney Road, Redruth TR15 1AB',
      occupier: '',
      premisesType: 'DOMESTIC',
      estimatedAgeOfWiring: null,
      evidenceOfAdditions: false,
      additionsEstimatedAge: null,
      installationRecordsAvailable: false,
      dateOfLastInspection: null,
    },
    reportReason: {
      purpose: 'PERIODIC',
      inspectionDates: ['2026-02-15'],
    },
    circuits: [],
    observations: [],
    createdAt: '2026-02-13T17:00:00Z',
    updatedAt: '2026-02-13T17:05:00Z',
  },
]

// ============================================================
// HELPERS
// ============================================================

function getStatusConfig(status: CertificateStatus) {
  switch (status) {
    case 'DRAFT':
      return {
        label: 'Draft',
        badgeClass: 'cv-badge-warning',
        icon: FileText,
      }
    case 'IN_PROGRESS':
      return {
        label: 'In Progress',
        badgeClass: 'cv-badge-pass',
        icon: Clock,
      }
    case 'COMPLETED':
      return {
        label: 'Completed',
        badgeClass: 'cv-badge-pass',
        icon: CheckCircle2,
      }
    case 'SUBMITTED':
      return {
        label: 'Submitted',
        badgeClass: 'cv-badge-pass',
        icon: CheckCircle2,
      }
    default:
      return {
        label: status,
        badgeClass: 'cv-badge-warning',
        icon: FileText,
      }
  }
}

function countObservationsByCode(
  observations: EICRCertificate['observations'],
  code: ClassificationCode
): number {
  return observations.filter((o) => o.classificationCode === code).length
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatTimeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours < 1) return 'Just now'
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days === 1) return 'Yesterday'
    return `${days}d ago`
  } catch {
    return ''
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')

  // --- Filtered certificates ---
  const filteredCerts = useMemo(() => {
    try {
      let results = [...MOCK_CERTIFICATES]

      // Status filter
      if (statusFilter !== 'ALL') {
        results = results.filter((c) => c.status === statusFilter)
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        results = results.filter((c) => {
          const address = c.installationDetails?.installationAddress?.toLowerCase() ?? ''
          const client = c.clientDetails?.clientName?.toLowerCase() ?? ''
          const report = c.reportNumber?.toLowerCase() ?? ''
          return address.includes(q) || client.includes(q) || report.includes(q)
        })
      }

      // Sort by updatedAt descending
      results.sort((a, b) => {
        const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return db - da
      })

      return results
    } catch (error) {
      captureError(error, 'Home.filteredCerts')
      return []
    }
  }, [searchQuery, statusFilter])

  // --- Stats ---
  const stats = useMemo(() => {
    const all = MOCK_CERTIFICATES
    return {
      total: all.length,
      inProgress: all.filter((c) => c.status === 'IN_PROGRESS').length,
      drafts: all.filter((c) => c.status === 'DRAFT').length,
      completed: all.filter((c) => c.status === 'COMPLETED').length,
    }
  }, [])

  // --- Filter tabs ---
  const FILTERS: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'ALL', label: 'All', count: stats.total },
    { value: 'IN_PROGRESS', label: 'Active', count: stats.inProgress },
    { value: 'DRAFT', label: 'Drafts', count: stats.drafts },
    { value: 'COMPLETED', label: 'Done', count: stats.completed },
  ]

  return (
    <>
      <Helmet>
        <title>Dashboard | CertVoice</title>
        <meta
          name="description"
          content="CertVoice dashboard — manage your EICR certificates"
        />
      </Helmet>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-certvoice-text flex items-center gap-2">
              <Zap className="w-5 h-5 text-certvoice-accent" />
              CertVoice
            </h1>
            <p className="text-xs text-certvoice-muted mt-0.5">
              Voice-first EICR certificates
            </p>
          </div>
          <Link
            to="/inspection/new"
            className="cv-btn-primary flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            <Plus className="w-4 h-4" />
            New EICR
          </Link>
        </div>

        {/* ---- Quick Stats ---- */}
        <div className="grid grid-cols-3 gap-2">
          <div className="cv-panel text-center py-3">
            <div className="text-xl font-bold text-certvoice-accent font-mono">
              {stats.inProgress}
            </div>
            <div className="text-[10px] text-certvoice-muted uppercase tracking-wider mt-0.5">
              Active
            </div>
          </div>
          <div className="cv-panel text-center py-3">
            <div className="text-xl font-bold text-certvoice-amber font-mono">
              {stats.drafts}
            </div>
            <div className="text-[10px] text-certvoice-muted uppercase tracking-wider mt-0.5">
              Drafts
            </div>
          </div>
          <div className="cv-panel text-center py-3">
            <div className="text-xl font-bold text-certvoice-green font-mono">
              {stats.completed}
            </div>
            <div className="text-[10px] text-certvoice-muted uppercase tracking-wider mt-0.5">
              Completed
            </div>
          </div>
        </div>

        {/* ---- Voice Shortcut ---- */}
        <Link
          to="/inspection/new"
          className="cv-panel flex items-center gap-4 p-4 border-certvoice-accent/30
                     hover:border-certvoice-accent transition-colors cursor-pointer"
        >
          <div
            className="w-12 h-12 rounded-full bg-certvoice-accent/15 border-2 border-certvoice-accent
                        flex items-center justify-center shrink-0"
          >
            <Mic className="w-5 h-5 text-certvoice-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold text-certvoice-text">
              Start voice capture
            </div>
            <div className="text-xs text-certvoice-muted mt-0.5">
              Speak your findings — AI extracts the fields
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-certvoice-muted ml-auto shrink-0" />
        </Link>

        {/* ---- Search ---- */}
        <div className="relative">
          <Search className="w-4 h-4 text-certvoice-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by address, client, or report no."
            className="w-full bg-certvoice-surface border border-certvoice-border rounded-lg
                       pl-9 pr-3 py-2.5 text-sm text-certvoice-text
                       placeholder:text-certvoice-muted/50 outline-none
                       focus:border-certvoice-accent transition-colors"
          />
        </div>

        {/* ---- Filter Tabs ---- */}
        <div className="flex gap-1 bg-certvoice-surface border border-certvoice-border rounded-lg p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`flex-1 px-2 py-2 rounded-md text-xs font-semibold transition-colors ${
                statusFilter === f.value
                  ? 'bg-certvoice-accent text-white'
                  : 'text-certvoice-muted hover:text-certvoice-text'
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-70">{f.count}</span>
            </button>
          ))}
        </div>

        {/* ---- Certificate List ---- */}
        <div className="space-y-2">
          {filteredCerts.length === 0 ? (
            <div className="cv-panel text-center py-10">
              <FileText className="w-8 h-8 text-certvoice-muted/40 mx-auto mb-2" />
              <p className="text-sm text-certvoice-muted">
                {searchQuery
                  ? 'No certificates match your search'
                  : 'No certificates yet'}
              </p>
              <Link
                to="/inspection/new"
                className="text-xs text-certvoice-accent hover:underline mt-2 inline-block"
              >
                Start your first inspection
              </Link>
            </div>
          ) : (
            filteredCerts.map((cert) => {
              const status = cert.status ?? 'DRAFT'
              const config = getStatusConfig(status)
              const StatusIcon = config.icon
              const observations = cert.observations ?? []
              const c1Count = countObservationsByCode(observations, 'C1')
              const c2Count = countObservationsByCode(observations, 'C2')
              const c3Count = countObservationsByCode(observations, 'C3')
              const circuitCount = cert.circuits?.length ?? 0

              return (
                <Link
                  key={cert.id}
                  to={
                    status === 'DRAFT'
                      ? '/inspection/new'
                      : `/inspection/capture`
                  }
                  state={{ certificate: cert }}
                  className="cv-panel block p-4 hover:border-certvoice-accent/50 transition-colors"
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-certvoice-text truncate">
                        {cert.installationDetails?.installationAddress ?? 'No address'}
                      </div>
                      <div className="text-xs text-certvoice-muted mt-0.5">
                        {cert.clientDetails?.clientName ?? 'No client'} ·{' '}
                        {cert.reportNumber}
                      </div>
                    </div>
                    <span className={`${config.badgeClass} shrink-0 ml-2`}>
                      <StatusIcon className="w-3 h-3 inline mr-1" />
                      {config.label}
                    </span>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-certvoice-muted">
                      {circuitCount} circuit{circuitCount !== 1 ? 's' : ''}
                    </span>

                    {c1Count > 0 && (
                      <span className="cv-code-c1 text-[10px] px-1.5 py-0.5 rounded">
                        C1: {c1Count}
                      </span>
                    )}
                    {c2Count > 0 && (
                      <span className="cv-code-c2 text-[10px] px-1.5 py-0.5 rounded">
                        C2: {c2Count}
                      </span>
                    )}
                    {c3Count > 0 && (
                      <span className="cv-code-c3 text-[10px] px-1.5 py-0.5 rounded">
                        C3: {c3Count}
                      </span>
                    )}

                    <span className="text-certvoice-muted ml-auto">
                      {cert.updatedAt ? formatTimeAgo(cert.updatedAt) : ''}
                    </span>
                  </div>

                  {/* Date row */}
                  <div className="text-[10px] text-certvoice-muted/60 mt-2">
                    Inspected:{' '}
                    {cert.reportReason?.inspectionDates?.[0]
                      ? formatDate(cert.reportReason.inspectionDates[0])
                      : '—'}
                  </div>
                </Link>
              )
            })
          )}
        </div>

        {/* ---- Bottom spacer ---- */}
        <div className="h-8" />
      </div>
    </>
  )
}
