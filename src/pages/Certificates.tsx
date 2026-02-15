/**
 * CertVoice — Certificates Page
 *
 * List of all EICR certificates with search, status filtering,
 * and quick access to continue drafts or view completed PDFs.
 *
 * Calls GET /api/certificates (wired in worker deployment phase).
 * Until then, displays empty state gracefully.
 *
 * @module pages/Certificates
 */

import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  ArrowLeft,
  Search,
  FileText,
  Clock,
  CheckCircle2,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Download,
  Send,
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

interface CertificateListItem {
  id: string
  reportNumber: string
  status: CertificateStatus
  clientName: string
  installationAddress: string
  inspectionDate: string | null
  circuitCount: number
  observationCounts: Record<ClassificationCode, number>
  hasPdf: boolean
  updatedAt: string
}

// ============================================================
// CONSTANTS
// ============================================================

const API_URL = '/api/certificates'

// ============================================================
// HELPERS
// ============================================================

function getStatusConfig(status: CertificateStatus) {
  switch (status) {
    case 'DRAFT':
      return { label: 'Draft', badgeClass: 'cv-badge bg-certvoice-surface-2 text-certvoice-muted', icon: FileText }
    case 'IN_PROGRESS':
      return { label: 'In Progress', badgeClass: 'cv-badge-warning', icon: Clock }
    case 'REVIEW':
      return { label: 'Review', badgeClass: 'cv-badge-warning', icon: FileText }
    case 'COMPLETE':
      return { label: 'Complete', badgeClass: 'cv-badge-pass', icon: CheckCircle2 }
    case 'ISSUED':
      return { label: 'Issued', badgeClass: 'cv-badge-pass', icon: Send }
    default:
      return { label: status, badgeClass: 'cv-badge-warning', icon: FileText }
  }
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
    if (days < 30) return `${days}d ago`
    const months = Math.floor(days / 30)
    return `${months}mo ago`
  } catch {
    return ''
  }
}

function mapCertToListItem(cert: Partial<EICRCertificate>): CertificateListItem {
  const observations = cert.observations ?? []
  return {
    id: cert.id ?? '',
    reportNumber: cert.reportNumber ?? '',
    status: cert.status ?? 'DRAFT',
    clientName: cert.clientDetails?.clientName ?? 'No client',
    installationAddress: cert.installationDetails?.installationAddress ?? 'No address',
    inspectionDate: cert.reportReason?.inspectionDates?.[0] ?? null,
    circuitCount: cert.circuits?.length ?? 0,
    observationCounts: {
      C1: observations.filter((o) => o.classificationCode === 'C1').length,
      C2: observations.filter((o) => o.classificationCode === 'C2').length,
      C3: observations.filter((o) => o.classificationCode === 'C3').length,
      FI: observations.filter((o) => o.classificationCode === 'FI').length,
    },
    hasPdf: false,
    updatedAt: cert.updatedAt ?? '',
  }
}

function getCertLink(cert: CertificateListItem): string {
  switch (cert.status) {
    case 'DRAFT':
      return '/new'
    case 'COMPLETE':
    case 'ISSUED':
      return `/inspect/${cert.id}`
    default:
      return `/inspect/${cert.id}`
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function Certificates() {
  const [certificates, setCertificates] = useState<CertificateListItem[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')

  // ---- Load certificates ----
  useEffect(() => {
    loadCertificates()
  }, [])

  const loadCertificates = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(API_URL, {
        method: 'GET',
        credentials: 'include',
      })

      if (response.ok) {
        const data = (await response.json()) as Partial<EICRCertificate>[]
        setCertificates(data.map(mapCertToListItem))
      } else if (response.status === 404 || response.status === 401) {
        // No certs or not authenticated yet — show empty state
        setCertificates([])
      } else {
        throw new Error(`Failed to load certificates (${response.status})`)
      }
    } catch (err) {
      // API not wired yet — show empty state gracefully
      captureError(err, 'Certificates.loadCertificates')
      setCertificates([])
      setError(null)
    } finally {
      setLoading(false)
    }
  }

  // ---- Filtered + sorted list ----
  const filteredCerts = useMemo(() => {
    try {
      let results = [...certificates]

      if (statusFilter !== 'ALL') {
        results = results.filter((c) => c.status === statusFilter)
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        results = results.filter((c) =>
          c.installationAddress.toLowerCase().includes(q) ||
          c.clientName.toLowerCase().includes(q) ||
          c.reportNumber.toLowerCase().includes(q)
        )
      }

      results.sort((a, b) => {
        const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return db - da
      })

      return results
    } catch (err) {
      captureError(err, 'Certificates.filteredCerts')
      return []
    }
  }, [certificates, searchQuery, statusFilter])

  // ---- Stats ----
  const stats = useMemo(() => ({
    total: certificates.length,
    active: certificates.filter((c) => c.status === 'IN_PROGRESS' || c.status === 'REVIEW').length,
    drafts: certificates.filter((c) => c.status === 'DRAFT').length,
    completed: certificates.filter((c) => c.status === 'COMPLETE' || c.status === 'ISSUED').length,
  }), [certificates])

  const FILTERS: Array<{ value: StatusFilter; label: string; count: number }> = [
    { value: 'ALL', label: 'All', count: stats.total },
    { value: 'IN_PROGRESS', label: 'Active', count: stats.active },
    { value: 'DRAFT', label: 'Drafts', count: stats.drafts },
    { value: 'COMPLETE', label: 'Done', count: stats.completed },
  ]

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <>
      <Helmet>
        <title>Certificates | CertVoice</title>
        <meta name="description" content="All your EICR certificates — search, filter, and manage." />
      </Helmet>

      <div className="min-h-screen bg-certvoice-bg">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-certvoice-surface border-b border-certvoice-border px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <Link
              to="/"
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-text transition-colors"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="flex-1 text-sm font-bold text-certvoice-text">
              Certificates
            </h1>
            <Link
              to="/new"
              className="cv-btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              New EICR
            </Link>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-certvoice-red/10 border border-certvoice-red/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-certvoice-red shrink-0" />
              <p className="text-xs text-certvoice-red">{error}</p>
            </div>
          )}

          {/* Loading */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-3 text-certvoice-muted">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading certificates...</span>
              </div>
            </div>
          ) : (
            <>
              {/* Stats */}
              {certificates.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="cv-panel text-center py-3">
                    <div className="text-xl font-bold text-certvoice-accent font-mono">{stats.active}</div>
                    <div className="text-[10px] text-certvoice-muted uppercase tracking-wider mt-0.5">Active</div>
                  </div>
                  <div className="cv-panel text-center py-3">
                    <div className="text-xl font-bold text-certvoice-amber font-mono">{stats.drafts}</div>
                    <div className="text-[10px] text-certvoice-muted uppercase tracking-wider mt-0.5">Drafts</div>
                  </div>
                  <div className="cv-panel text-center py-3">
                    <div className="text-xl font-bold text-certvoice-green font-mono">{stats.completed}</div>
                    <div className="text-[10px] text-certvoice-muted uppercase tracking-wider mt-0.5">Completed</div>
                  </div>
                </div>
              )}

              {/* Search */}
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

              {/* Filter Tabs */}
              {certificates.length > 0 && (
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
              )}

              {/* Certificate List */}
              <div className="space-y-2">
                {filteredCerts.length === 0 ? (
                  <div className="cv-panel text-center py-14">
                    <FileText className="w-10 h-10 text-certvoice-muted/30 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-certvoice-text">
                      {searchQuery ? 'No certificates match your search' : 'No certificates yet'}
                    </p>
                    <p className="text-xs text-certvoice-muted mt-1">
                      {searchQuery
                        ? 'Try a different search term'
                        : 'Start your first EICR inspection to see it here'}
                    </p>
                    {!searchQuery && (
                      <Link
                        to="/new"
                        className="cv-btn-primary inline-flex items-center gap-2 mt-4 px-4 py-2 text-xs"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        New EICR Inspection
                      </Link>
                    )}
                  </div>
                ) : (
                  filteredCerts.map((cert) => {
                    const config = getStatusConfig(cert.status)
                    const StatusIcon = config.icon
                    const { C1, C2, C3, FI } = cert.observationCounts

                    return (
                      <Link
                        key={cert.id}
                        to={getCertLink(cert)}
                        className="cv-panel block p-4 hover:border-certvoice-accent/50 transition-colors"
                      >
                        {/* Top row */}
                        <div className="flex items-start justify-between mb-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-certvoice-text truncate">
                              {cert.installationAddress}
                            </div>
                            <div className="text-xs text-certvoice-muted mt-0.5">
                              {cert.clientName} · {cert.reportNumber}
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
                            {cert.circuitCount} circuit{cert.circuitCount !== 1 ? 's' : ''}
                          </span>

                          {C1 > 0 && (
                            <span className="cv-code-c1 text-[10px] px-1.5 py-0.5 rounded">C1: {C1}</span>
                          )}
                          {C2 > 0 && (
                            <span className="cv-code-c2 text-[10px] px-1.5 py-0.5 rounded">C2: {C2}</span>
                          )}
                          {C3 > 0 && (
                            <span className="cv-code-c3 text-[10px] px-1.5 py-0.5 rounded">C3: {C3}</span>
                          )}
                          {FI > 0 && (
                            <span className="cv-code-fi text-[10px] px-1.5 py-0.5 rounded">FI: {FI}</span>
                          )}

                          {cert.hasPdf && (
                            <Download className="w-3 h-3 text-certvoice-green ml-auto shrink-0" />
                          )}
                          {!cert.hasPdf && (
                            <span className="text-certvoice-muted ml-auto">
                              {cert.updatedAt ? formatTimeAgo(cert.updatedAt) : ''}
                            </span>
                          )}
                        </div>

                        {/* Date row */}
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] text-certvoice-muted/60">
                            Inspected: {cert.inspectionDate ? formatDate(cert.inspectionDate) : '—'}
                          </span>
                          <ChevronRight className="w-3 h-3 text-certvoice-muted/40" />
                        </div>
                      </Link>
                    )
                  })
                )}
              </div>
            </>
          )}

          {/* Bottom spacer */}
          <div className="h-8" />
        </div>
      </div>
    </>
  )
}
