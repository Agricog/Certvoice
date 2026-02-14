// ============================================================
// src/pages/Home.tsx
// CertVoice - Dashboard Home Page
// Phase 3: Certificate Assembly - Item #30
// ============================================================

import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  Plus,
  FileText,
  Clock,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  Search,
  Filter,
  Calendar,
  MapPin,
  Zap,
  BarChart3,
  Settings,
  HelpCircle,
  Mic,
} from 'lucide-react'
import { captureError } from '../utils/errorTracking'
import type { EICRCertificate } from '../types/eicr'

// ============================================================
// TYPES
// ============================================================

interface CertificateSummary {
  id: string
  reportNumber: string
  status: 'draft' | 'complete' | 'submitted'
  address: string
  clientName: string
  inspectionDate: string
  circuitCount: number
  observationCount: number
  hasC1OrC2: boolean
  updatedAt: string
}

interface DashboardStats {
  drafts: number
  completedThisMonth: number
  avgTimePerInspection: string
}

// ============================================================
// MOCK DATA (Replace with real data fetching)
// ============================================================

const MOCK_STATS: DashboardStats = {
  drafts: 2,
  completedThisMonth: 12,
  avgTimePerInspection: '1.5 hrs',
}

// ============================================================
// COMPONENT
// ============================================================

export default function Home() {
  const navigate = useNavigate()
  
  // State
  const [certificates, setCertificates] = useState<CertificateSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'complete'>('all')
  const [stats, setStats] = useState<DashboardStats>(MOCK_STATS)

  // Load certificates
  useEffect(() => {
    const loadCertificates = async () => {
      setIsLoading(true)
      try {
        // Check for drafts in sessionStorage
        const drafts: CertificateSummary[] = []
        
        const draftCert = sessionStorage.getItem('certvoice_draft_certificate')
        if (draftCert) {
          try {
            const parsed = JSON.parse(draftCert) as Partial<EICRCertificate>
            drafts.push({
              id: parsed.id || 'draft-1',
              reportNumber: parsed.reportNumber || 'Draft',
              status: 'draft',
              address: parsed.sectionC?.installationAddress?.split('\n')[0] || 'New Inspection',
              clientName: parsed.sectionA?.clientName || 'Unknown Client',
              inspectionDate: parsed.sectionB?.inspectionDate || new Date().toISOString().split('T')[0],
              circuitCount: parsed.circuits?.length || 0,
              observationCount: parsed.observations?.length || 0,
              hasC1OrC2: parsed.observations?.some((o) => o.classification === 'C1' || o.classification === 'C2') || false,
              updatedAt: parsed.updatedAt || new Date().toISOString(),
            })
          } catch {
            // Invalid draft, ignore
          }
        }

        // TODO: Load from backend
        // For now, use mock data plus any drafts
        const mockCompleted: CertificateSummary[] = [
          {
            id: 'cert-001',
            reportNumber: 'EICR-2026-001',
            status: 'complete',
            address: '15 Oak Avenue, Truro',
            clientName: 'Mrs J Williams',
            inspectionDate: '2026-02-10',
            circuitCount: 12,
            observationCount: 2,
            hasC1OrC2: false,
            updatedAt: '2026-02-10T16:30:00Z',
          },
          {
            id: 'cert-002',
            reportNumber: 'EICR-2026-002',
            status: 'complete',
            address: '8 High Street, Falmouth',
            clientName: 'ABC Lettings Ltd',
            inspectionDate: '2026-02-08',
            circuitCount: 8,
            observationCount: 3,
            hasC1OrC2: true,
            updatedAt: '2026-02-08T14:15:00Z',
          },
          {
            id: 'cert-003',
            reportNumber: 'EICR-2026-003',
            status: 'complete',
            address: '42 Maple Drive, Truro',
            clientName: 'Mr S Patel',
            inspectionDate: '2026-02-05',
            circuitCount: 14,
            observationCount: 0,
            hasC1OrC2: false,
            updatedAt: '2026-02-05T11:45:00Z',
          },
        ]

        setCertificates([...drafts, ...mockCompleted])
        setStats({
          drafts: drafts.length,
          completedThisMonth: mockCompleted.length,
          avgTimePerInspection: '1.5 hrs',
        })
      } catch (error) {
        captureError(error, 'Home.loadCertificates')
      } finally {
        setIsLoading(false)
      }
    }

    loadCertificates()
  }, [])

  // Filtered certificates
  const filteredCertificates = useMemo(() => {
    return certificates.filter((cert) => {
      // Status filter
      if (filterStatus !== 'all' && cert.status !== filterStatus) return false
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          cert.address.toLowerCase().includes(query) ||
          cert.clientName.toLowerCase().includes(query) ||
          cert.reportNumber.toLowerCase().includes(query)
        )
      }
      
      return true
    })
  }, [certificates, filterStatus, searchQuery])

  // Format date for display
  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
      
      if (diffDays === 0) return 'Today'
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      
      return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      })
    } catch {
      return dateStr
    }
  }

  // Handle new inspection
  const handleNewInspection = () => {
    navigate('/inspection/new')
  }

  // Handle continue draft
  const handleContinueDraft = (certId: string) => {
    navigate(`/inspection/${certId}/capture`)
  }

  // Handle view certificate
  const handleViewCertificate = (certId: string, status: string) => {
    if (status === 'draft') {
      navigate(`/inspection/${certId}/capture`)
    } else {
      navigate(`/inspection/${certId}/review`)
    }
  }

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <>
      <Helmet>
        <title>Dashboard | CertVoice</title>
        <meta name="description" content="CertVoice dashboard - manage your EICR electrical inspection certificates" />
      </Helmet>

      <div className="min-h-screen bg-bg">
        {/* Header */}
        <header className="bg-surface border-b border-border sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="font-bold text-xl text-text">CertVoice</h1>
                  <p className="text-xs text-text-muted">EICR Certificates</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Link
                  to="/settings"
                  className="p-2 rounded-lg hover:bg-surface-2 text-text-muted"
                  aria-label="Settings"
                >
                  <Settings className="w-5 h-5" />
                </Link>
                <Link
                  to="/help"
                  className="p-2 rounded-lg hover:bg-surface-2 text-text-muted"
                  aria-label="Help"
                >
                  <HelpCircle className="w-5 h-5" />
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {/* Quick Actions */}
          <section>
            <button
              type="button"
              onClick={handleNewInspection}
              className="w-full cv-panel bg-gradient-to-r from-accent to-accent/80 border-accent hover:from-accent/90 hover:to-accent/70 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center">
                    <Plus className="w-8 h-8 text-white" />
                  </div>
                  <div className="text-left">
                    <h2 className="text-lg font-semibold text-white">New EICR Inspection</h2>
                    <p className="text-sm text-white/80">Start a new certificate with voice capture</p>
                  </div>
                </div>
                <ChevronRight className="w-6 h-6 text-white/60" />
              </div>
            </button>
          </section>

          {/* Stats */}
          <section className="grid grid-cols-3 gap-3">
            <div className="cv-panel text-center">
              <div className="text-2xl font-bold text-amber-500">{stats.drafts}</div>
              <div className="text-xs text-text-muted mt-1">Drafts</div>
            </div>
            <div className="cv-panel text-center">
              <div className="text-2xl font-bold text-green-500">{stats.completedThisMonth}</div>
              <div className="text-xs text-text-muted mt-1">This Month</div>
            </div>
            <div className="cv-panel text-center">
              <div className="text-2xl font-bold text-accent">{stats.avgTimePerInspection}</div>
              <div className="text-xs text-text-muted mt-1">Avg Time</div>
            </div>
          </section>

          {/* Drafts Section */}
          {certificates.filter((c) => c.status === 'draft').length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Continue Where You Left Off
              </h2>
              <div className="space-y-3">
                {certificates
                  .filter((c) => c.status === 'draft')
                  .map((cert) => (
                    <button
                      key={cert.id}
                      type="button"
                      onClick={() => handleContinueDraft(cert.id)}
                      className="w-full cv-panel hover:border-accent/50 transition-colors text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                            <FileText className="w-5 h-5 text-amber-500" />
                          </div>
                          <div>
                            <div className="font-medium text-text">{cert.address}</div>
                            <div className="text-sm text-text-muted">
                              {cert.circuitCount} circuits • {cert.observationCount} observations
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="cv-badge bg-amber-500/20 text-amber-500">Draft</span>
                          <ChevronRight className="w-5 h-5 text-text-muted" />
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            </section>
          )}

          {/* All Certificates */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Recent Certificates
              </h2>
              <Link
                to="/certificates"
                className="text-sm text-accent hover:underline flex items-center gap-1"
              >
                View All
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            {/* Search and Filter */}
            <div className="flex gap-3 mb-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search address, client, or report number..."
                  className="cv-input w-full pl-10"
                />
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                className="cv-input"
              >
                <option value="all">All Status</option>
                <option value="draft">Drafts</option>
                <option value="complete">Complete</option>
              </select>
            </div>

            {/* Certificate List */}
            {isLoading ? (
              <div className="cv-panel text-center py-8">
                <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-text-muted">Loading certificates...</p>
              </div>
            ) : filteredCertificates.length === 0 ? (
              <div className="cv-panel text-center py-8">
                <FileText className="w-12 h-12 mx-auto text-text-muted mb-3" />
                <h3 className="font-semibold text-text mb-1">No Certificates Found</h3>
                <p className="text-sm text-text-muted mb-4">
                  {searchQuery || filterStatus !== 'all'
                    ? 'Try adjusting your search or filter'
                    : 'Start your first EICR inspection'}
                </p>
                {!searchQuery && filterStatus === 'all' && (
                  <button
                    type="button"
                    onClick={handleNewInspection}
                    className="cv-btn-primary inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    New Inspection
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCertificates.map((cert) => (
                  <button
                    key={cert.id}
                    type="button"
                    onClick={() => handleViewCertificate(cert.id, cert.status)}
                    className="w-full cv-panel hover:border-accent/50 transition-colors text-left"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`
                          w-10 h-10 rounded-lg flex items-center justify-center
                          ${cert.status === 'complete'
                            ? cert.hasC1OrC2
                              ? 'bg-red-500/20'
                              : 'bg-green-500/20'
                            : 'bg-amber-500/20'}
                        `}>
                          {cert.status === 'complete' ? (
                            cert.hasC1OrC2 ? (
                              <AlertTriangle className="w-5 h-5 text-red-500" />
                            ) : (
                              <CheckCircle className="w-5 h-5 text-green-500" />
                            )
                          ) : (
                            <Clock className="w-5 h-5 text-amber-500" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-text">{cert.address}</div>
                          <div className="text-sm text-text-muted">{cert.clientName}</div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatDate(cert.inspectionDate)}
                            </span>
                            <span>{cert.circuitCount} circuits</span>
                            {cert.observationCount > 0 && (
                              <span className={cert.hasC1OrC2 ? 'text-red-500' : ''}>
                                {cert.observationCount} obs
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`
                          cv-badge text-xs
                          ${cert.status === 'complete'
                            ? cert.hasC1OrC2
                              ? 'bg-red-500/20 text-red-500'
                              : 'bg-green-500/20 text-green-500'
                            : 'bg-amber-500/20 text-amber-500'}
                        `}>
                          {cert.status === 'complete'
                            ? cert.hasC1OrC2
                              ? 'Unsatisfactory'
                              : 'Satisfactory'
                            : 'Draft'}
                        </span>
                        <span className="text-xs text-text-muted font-mono">
                          {cert.reportNumber}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Quick Tips */}
          <section className="cv-panel bg-surface-2 border-border/50">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
                <Mic className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold text-text">Voice Capture Tip</h3>
                <p className="text-sm text-text-muted mt-1">
                  Speak naturally with trade terminology. Say "Kitchen ring final, circuit 3, Zs 0.42 ohms, 
                  R1+R2 0.31, insulation greater than 200 meg, all satisfactory" and CertVoice extracts 
                  all the fields automatically.
                </p>
              </div>
            </div>
          </section>
        </main>

        {/* Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border safe-area-bottom">
          <div className="max-w-6xl mx-auto px-4">
            <div className="flex items-center justify-around py-2">
              <Link
                to="/"
                className="flex flex-col items-center gap-1 px-4 py-2 text-accent"
              >
                <Zap className="w-5 h-5" />
                <span className="text-xs font-medium">Home</span>
              </Link>
              <Link
                to="/certificates"
                className="flex flex-col items-center gap-1 px-4 py-2 text-text-muted hover:text-text"
              >
                <FileText className="w-5 h-5" />
                <span className="text-xs">Certificates</span>
              </Link>
              <button
                type="button"
                onClick={handleNewInspection}
                className="flex flex-col items-center gap-1 px-4 py-2 -mt-4"
              >
                <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center shadow-lg">
                  <Plus className="w-6 h-6 text-white" />
                </div>
              </button>
              <Link
                to="/analytics"
                className="flex flex-col items-center gap-1 px-4 py-2 text-text-muted hover:text-text"
              >
                <BarChart3 className="w-5 h-5" />
                <span className="text-xs">Analytics</span>
              </Link>
              <Link
                to="/settings"
                className="flex flex-col items-center gap-1 px-4 py-2 text-text-muted hover:text-text"
              >
                <Settings className="w-5 h-5" />
                <span className="text-xs">Settings</span>
              </Link>
            </div>
          </div>
        </nav>
      </div>
    </>
  )
}
