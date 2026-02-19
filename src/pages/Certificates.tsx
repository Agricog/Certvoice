/**
 * CertVoice — Certificates Page
 *
 * List of all certificates (EICR, Minor Works, EIC) with search,
 * status filtering, and cert type filtering.
 *
 * Offline-first: loads from IndexedDB immediately, then merges
 * API results when online.
 *
 * @module pages/Certificates
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
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
  Download,
  Send,
  RefreshCw,
  WifiOff,
  Wrench,
  ClipboardList,
  Award,
} from 'lucide-react'
import type {
  EICRCertificate,
  CertificateStatus,
  ClassificationCode,
} from '../types/eicr'
import type { CertificateType } from '../types/minorWorks'
import { captureError } from '../utils/errorTracking'
import { listLocalCertificates } from '../services/offlineStore'
import { listCertificates } from '../services/certificateApi'
import { useApiToken } from '../hooks/useApiToken'

// ============================================================
// TYPES
// ============================================================

type StatusFilter = 'ALL' | CertificateStatus
type CertTypeFilter = 'ALL' | CertificateType
type OverallAssessment = 'SATISFACTORY' | 'UNSATISFACTORY' | null

interface CertificateListItem {
  id: string
  reportNumber: string
  status: CertificateStatus
  certificateType: CertificateType
  clientName: string
  installationAddress: string
  inspectionDate: string | null
  circuitCount: number
  observationCounts: Record<ClassificationCode, number>
  overallAssessment: OverallAssessment
  hasPdf: boolean
  updatedAt: string
  isLocal: boolean
  /** MW: description of work (shown instead of circuit count) */
  descriptionOfWork?: string
}

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

function mapCertToListItem(cert: Partial<EICRCertificate>, isLocal = false): CertificateListItem {
  // Detect Minor Works certificates stored via IndexedDB (cast through unknown)
  const raw = cert as unknown as Record<string, unknown>
  const isMW = raw.certificateType === 'MINOR_WORKS'

  if (isMW) {
    const mw = raw as Record<string, unknown>
    const client = mw.clientDetails as Record<string, string> | undefined
    const desc = mw.description as Record<string, string> | undefined
    return {
      id: String(mw.id ?? ''),
      reportNumber: '',
      status: (mw.status as CertificateStatus) ?? 'DRAFT',
      certificateType: 'MINOR_WORKS',
      clientName: client?.clientName ?? 'No client',
      installationAddress: client?.clientAddress ?? 'No address',
      inspectionDate: desc?.dateOfCompletion ?? null,
      circuitCount: 0,
      observationCounts: { C1: 0, C2: 0, C3: 0, FI: 0 },
      overallAssessment: null,
      hasPdf: false,
      updatedAt: String(mw.updatedAt ?? ''),
      isLocal,
      descriptionOfWork: desc?.descriptionOfWork ?? '',
    }
  }

  // EICR certificate
  const observations = cert.observations ?? []
  const assessment = cert.summaryOfCondition?.overallAssessment ?? null
  return {
    id: cert.id ?? '',
    reportNumber: cert.reportNumber ?? '',
    status: cert.status ?? 'DRAFT',
    certificateType: 'EICR',
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
    overallAssessment: assessment as OverallAssessment,
    hasPdf: false,
    updatedAt: cert.updatedAt ?? '',
    isLocal,
  }
}

function getCertLink(cert: CertificateListItem): string {
  if (cert.certificateType === 'MINOR_WORKS') {
    return `/minor-works/${cert.id}`
  }
  if (cert.certificateType === 'EIC') {
    return `/eic/${cert.id}`
  }
  return `/inspect/${cert.id}`
}

// ============================================================
// COMPONENT
// ============================================================

export default function Certificates() {
  const { getToken } = useApiToken()
  const [certificates, setCertificates] = useState<CertificateListItem[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState(false)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [certTypeFilter, setCertTypeFilter] = useState<CertTypeFilter>('ALL')

  // ---- Connectivity listener ----
  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // ---- Load certificates (offline-first) ----
  const loadCertificates = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      // Step 1: Load from IndexedDB immediately (instant, no network)
      let localItems: CertificateListItem[] = []
      try {
        const localCerts = await listLocalCertificates()
        localItems = localCerts.map((stored) => mapCertToListItem(stored.data, true))
      } catch (err) {
        captureError(err, 'Certificates.loadLocal')
      }

      // Show local data immediately
      if (localItems.length > 0) {
        setCertificates(localItems)
        setLoading(false)
      }

      // Step 2: Try API (merge results, API is source of truth for completed certs)
      if (navigator.onLine) {
        try {
          const { data: apiCerts } = await listCertificates(getToken)
          const apiItems = apiCerts.map((c) => mapCertToListItem(c as unknown as Partial<EICRCertificate>, false))
          // Merge: API wins for matching IDs, keep local-only certs
          const apiIds = new Set(apiItems.map((c) => c.id))
          const localOnly = localItems.filter((c) => !apiIds.has(c.id))
          const merged = [...apiItems, ...localOnly]

          setCertificates(merged)
        } catch (err) {
          // API failed — local data already shown, just log
          captureError(err, 'Certificates.loadApi')
        }
      }
    } catch (err) {
      captureError(err, 'Certificates.loadCertificates')
      setCertificates([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [getToken])

  useEffect(() => {
    loadCertificates()
  }, [loadCertificates])

  // ---- Filtered + sorted list ----
  const filteredCerts = useMemo(() => {
    try {
      let results = [...certificates]

      // Cert type filter
      if (certTypeFilter !== 'ALL') {
        results = results.filter((c) => c.certificateType === certTypeFilter)
      }

      if (statusFilter !== 'ALL') {
        results = results.filter((c) => c.status === statusFilter)
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        results = results.filter((c) =>
          c.installationAddress.toLowerCase().includes(q) ||
          c.clientName.toLowerCase().includes(q) ||
          c.reportNumber.toLowerCase().includes(q) ||
          (c.descriptionOfWork ?? '').toLowerCase().includes(q)
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
  }, [certificates, searchQuery, statusFilter, certTypeFilter])

  // ---- Stats ----
  const stats = useMemo(() => ({
    total: certificates.length,
    active: certificates.filter((c) => c.status === 'IN_PROGRESS' || c.status === 'REVIEW').length,
    drafts: certificates.filter((c) => c.status === 'DRAFT').length,
    completed: certificates.filter((c) => c.status === 'COMPLETE' || c.status === 'ISSUED').length,
  }), [certificates])

  const certTypeCounts = useMemo(() => ({
    all: certificates.length,
    eicr: certificates.filter((c) => c.certificateType === 'EICR').length,
    mw: certificates.filter((c) => c.certificateType === 'MINOR_WORKS').length,
    eic: certificates.filter((c) => c.certificateType === 'EIC').length,
  }), [certificates])

  const FILTERS: Array<{ value: StatusFilter; label: string; count: number }> = [
    { value: 'ALL', label: 'All', count: stats.total },
    { value: 'IN_PROGRESS', label: 'Active', count: stats.active },
    { value: 'DRAFT', label: 'Drafts', count: stats.drafts },
    { value: 'COMPLETE', label: 'Done', count: stats.completed },
  ]

  const CERT_TYPE_FILTERS: Array<{ value: CertTypeFilter; label: string; count: number; icon: React.ElementType }> = [
    { value: 'ALL', label: 'All Types', count: certTypeCounts.all, icon: FileText },
    { value: 'EICR', label: 'EICR', count: certTypeCounts.eicr, icon: ClipboardList },
    { value: 'MINOR_WORKS', label: 'Minor Works', count: certTypeCounts.mw, icon: Wrench },
    { value: 'EIC', label: 'EIC', count: certTypeCounts.eic, icon: Award },
  ]

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <>
      <Helmet>
        <title>Certificates | CertVoice</title>
        <meta name="description" content="All your electrical certificates — search, filter, and manage." />
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
            {isOffline && (
              <span className="flex items-center gap-1 text-[10px] text-certvoice-amber font-semibold">
                <WifiOff className="w-3 h-3" />
                Offline
              </span>
            )}
            <button
              type="button"
              onClick={() => loadCertificates(true)}
              disabled={refreshing}
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-accent hover:border-certvoice-accent transition-colors
                         disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <Link
              to="/new"
              className="cv-btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              New
            </Link>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
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
                  placeholder="Search by address, client, report no., or description"
                  className="w-full bg-certvoice-surface border border-certvoice-border rounded-lg
                             pl-9 pr-3 py-2.5 text-sm text-certvoice-text
                             placeholder:text-certvoice-muted/50 outline-none
                             focus:border-certvoice-accent transition-colors"
                />
              </div>

              {/* Cert Type Filter */}
              {certificates.length > 0 && (certTypeCounts.mw > 0 || certTypeCounts.eic > 0) && (
                <div className="flex gap-1">
                  {CERT_TYPE_FILTERS.map((f) => {
                    const Icon = f.icon
                    return (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setCertTypeFilter(f.value)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          certTypeFilter === f.value
                            ? 'bg-certvoice-accent/15 border-certvoice-accent text-certvoice-accent'
                            : 'bg-certvoice-surface border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        {f.label}
                        <span className="opacity-60">{f.count}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Status Filter Tabs */}
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
                        : 'Start your first certificate to see it here'}
                    </p>
                    {!searchQuery && (
                      <Link
                        to="/new"
                        className="cv-btn-primary inline-flex items-center gap-2 mt-4 px-4 py-2 text-xs"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        New Certificate
                      </Link>
                    )}
                  </div>
                ) : (
                  filteredCerts.map((cert) => {
                    const config = getStatusConfig(cert.status)
                    const StatusIcon = config.icon
                    const isMW = cert.certificateType === 'MINOR_WORKS'
                    const isEIC = cert.certificateType === 'EIC'
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
                              {cert.clientName}
                              {cert.reportNumber ? ` · ${cert.reportNumber}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {/* Cert type badge */}
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              isMW
                                ? 'bg-certvoice-amber/15 text-certvoice-amber'
                                : isEIC
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-certvoice-accent/15 text-certvoice-accent'
                            }`}>
                              {isMW ? 'MW' : isEIC ? 'EIC' : 'EICR'}
                            </span>

                            {cert.overallAssessment && (
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                  cert.overallAssessment === 'SATISFACTORY'
                                    ? 'cv-badge-pass'
                                    : 'cv-badge-fail'
                                }`}
                              >
                                {cert.overallAssessment === 'SATISFACTORY' ? 'SAT' : 'UNSAT'}
                              </span>
                            )}
                            <span className={`${config.badgeClass} shrink-0`}>
                              <StatusIcon className="w-3 h-3 inline mr-1" />
                              {config.label}
                            </span>
                          </div>
                        </div>

                        {/* Stats row */}
                        <div className="flex items-center gap-3 text-xs">
                          {isMW ? (
                            <span className="text-certvoice-muted truncate max-w-[200px]">
                              {cert.descriptionOfWork || 'No description'}
                            </span>
                          ) : (
                            <>
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
                            </>
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
                            {isMW
                              ? `Completed: ${cert.inspectionDate ? formatDate(cert.inspectionDate) : '—'}`
                              : `Inspected: ${cert.inspectionDate ? formatDate(cert.inspectionDate) : '—'}`}
                            {cert.isLocal && ' · Local only'}
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
