/**
 * CertVoice — NAPIT Notification Export
 *
 * Structured copy-paste interface for NAPIT Online portal notifications.
 * NAPIT has NO public API — this is a "smart clipboard" approach matching
 * the portal field order so electricians can copy each section and paste.
 *
 * NOTE: Only EIC and notifiable Minor Works require Part P notification.
 * EICRs do NOT require notification to NAPIT/NICEIC/Building Control.
 *
 * @module pages/NapitExport
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  ArrowLeft,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Info,
  Zap,
} from 'lucide-react'
import { getCertificate } from '../services/offlineStore'
import { captureError } from '../utils/errorTracking'
import type { EICRCertificate } from '../types/eicr'

// ============================================================
// TYPES
// ============================================================

type CertType = 'eicr' | 'eic' | 'minorworks'
type PageState = 'loading' | 'ready' | 'error' | 'not-applicable'

interface SectionDef {
  id: string
  title: string
  format: (cert: Partial<EICRCertificate>, fields: NapitFields) => string
}

interface NapitFields {
  napitMembershipNo: string
  certificateSerial: string
  workCategory: string
  workDescription: string
  completionDate: string
}

// ============================================================
// WORK CATEGORIES (NAPIT Part P notification)
// ============================================================

const WORK_CATEGORIES = [
  'New installation',
  'New circuit(s)',
  'Replacement consumer unit',
  'Addition or alteration to existing circuit(s)',
  'Rewire',
  'New circuit in special location (bathroom/kitchen)',
  'Outdoor installation (garden/outbuilding)',
  'Other notifiable work',
] as const

// ============================================================
// ANALYTICS HELPER (gtag not exported from analytics.ts)
// ============================================================

function trackNapitEvent(action: string, label?: string): void {
  try {
    if (typeof window !== 'undefined' && 'gtag' in window) {
      const w = window as unknown as { gtag: (...args: unknown[]) => void }
      w.gtag('event', action, {
        event_category: 'napit_export',
        event_label: label,
      })
    }
  } catch {
    // Analytics must never break functionality
  }
}

// ============================================================
// SECTION FORMATTERS
// ============================================================

function joinFields(pairs: [string, string | null | undefined][]): string {
  return pairs
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')
}

function extractPostcode(address?: string | null): string | null {
  if (!address) return null
  const match = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)
  return match ? match[0].toUpperCase() : null
}

const EIC_SECTIONS: SectionDef[] = [
  {
    id: 'contractor',
    title: 'Contractor Details',
    format: (cert, fields) => joinFields([
      ['NAPIT Membership No', fields.napitMembershipNo],
      ['Company Name', cert.declaration?.companyName ?? ''],
      ['Inspector Name', cert.declaration?.inspectorName ?? ''],
      ['Address', cert.declaration?.companyAddress ?? ''],
      ['Position', cert.declaration?.position ?? ''],
      ['Registration No', cert.declaration?.registrationNumber ?? ''],
      ['Certificate Serial No', fields.certificateSerial || cert.reportNumber || ''],
    ]),
  },
  {
    id: 'installation',
    title: 'Installation Address',
    format: (cert) => joinFields([
      ['Address', cert.installationDetails?.installationAddress ?? ''],
      ['Postcode', extractPostcode(cert.installationDetails?.installationAddress) ?? ''],
      ['Premises Type', cert.installationDetails?.premisesType ?? ''],
      ['Occupier', cert.installationDetails?.occupier ?? ''],
    ]),
  },
  {
    id: 'client',
    title: 'Client Details',
    format: (cert) => joinFields([
      ['Client Name', cert.clientDetails?.clientName ?? ''],
      ['Client Address', cert.clientDetails?.clientAddress ?? ''],
    ]),
  },
  {
    id: 'work',
    title: 'Work Details',
    format: (cert, fields) => joinFields([
      ['Work Category', fields.workCategory],
      ['Description of Work', fields.workDescription
        || cert.extentAndLimitations?.extentCovered || ''],
      ['Date of Completion', fields.completionDate || cert.declaration?.dateInspected || ''],
    ]),
  },
  {
    id: 'all',
    title: 'All Fields (Combined)',
    format: (cert, fields) => {
      const sections = EIC_SECTIONS.filter((s) => s.id !== 'all')
      return sections.map((s) => `--- ${s.title} ---\n${s.format(cert, fields)}`).join('\n\n')
    },
  },
]

// ============================================================
// COMPONENT
// ============================================================

export default function NapitExport() {
  const { certType, id } = useParams<{ certType: string; id: string }>()
  const resolvedType = (certType ?? 'eic') as CertType

  // --- State ---
  const [pageState, setPageState] = useState<PageState>('loading')
  const [certificate, setCertificate] = useState<Partial<EICRCertificate>>({})
  const [copiedSections, setCopiedSections] = useState<Set<string>>(new Set())
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['contractor', 'installation', 'client', 'work']))
  const [loadError, setLoadError] = useState<string | null>(null)

  // --- NAPIT-specific editable fields ---
  const [napitFields, setNapitFields] = useState<NapitFields>({
    napitMembershipNo: '',
    certificateSerial: '',
    workCategory: WORK_CATEGORIES[0],
    workDescription: '',
    completionDate: '',
  })

  // ============================================================
  // LOAD CERTIFICATE
  // ============================================================

  useEffect(() => {
    async function load() {
      if (!id) {
        setLoadError('No certificate ID provided')
        setPageState('error')
        return
      }

      // EICRs don't need Part P notification
      if (resolvedType === 'eicr') {
        setPageState('not-applicable')
        return
      }

      try {
        const local = await getCertificate(id)
        if (!local?.data) {
          setLoadError('Certificate not found in local storage')
          setPageState('error')
          return
        }

        const data = local.data as Partial<EICRCertificate>
        setCertificate(data)

        // Pre-fill editable fields from certificate data
        setNapitFields((prev) => ({
          ...prev,
          certificateSerial: data.reportNumber ?? '',
          completionDate: data.declaration?.dateInspected ?? '',
          workDescription: data.extentAndLimitations?.extentCovered ?? '',
        }))

        setPageState('ready')
        trackNapitEvent('export_opened', resolvedType)
      } catch (err) {
        captureError(err, 'NapitExport.load')
        setLoadError('Failed to load certificate')
        setPageState('error')
      }
    }

    load()
  }, [id, resolvedType])

  // ============================================================
  // COPY HANDLER
  // ============================================================

  const handleCopy = useCallback(async (sectionId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSections((prev) => new Set(prev).add(sectionId))
      trackNapitEvent('section_copied', sectionId)

      setTimeout(() => {
        setCopiedSections((prev) => {
          const next = new Set(prev)
          next.delete(sectionId)
          return next
        })
      }, 3000)
    } catch (err) {
      captureError(err, 'NapitExport.handleCopy')
    }
  }, [])

  const handleCopyAll = useCallback(async () => {
    const allSection = EIC_SECTIONS.find((s) => s.id === 'all')
    if (!allSection) return
    const text = allSection.format(certificate, napitFields)
    await handleCopy('all', text)
  }, [certificate, napitFields, handleCopy])

  // ============================================================
  // SECTION TOGGLE
  // ============================================================

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  // ============================================================
  // FIELD UPDATE
  // ============================================================

  const updateField = useCallback((field: keyof NapitFields, value: string) => {
    setNapitFields((prev) => ({ ...prev, [field]: value }))
  }, [])

  // ============================================================
  // PROGRESS
  // ============================================================

  const copyableSections = EIC_SECTIONS.filter((s) => s.id !== 'all')
  const copiedCount = useMemo(
    () => copyableSections.filter((s) => copiedSections.has(s.id)).length,
    [copiedSections, copyableSections]
  )
  const progressPct = copyableSections.length > 0
    ? Math.round((copiedCount / copyableSections.length) * 100)
    : 0

  // ============================================================
  // RENDER: LOADING
  // ============================================================

  if (pageState === 'loading') {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <Loader2 className="w-8 h-8 text-certvoice-accent animate-spin mx-auto mb-3" />
        <p className="text-sm text-certvoice-muted">Loading certificate…</p>
      </div>
    )
  }

  // ============================================================
  // RENDER: EICR NOT APPLICABLE
  // ============================================================

  if (pageState === 'not-applicable') {
    return (
      <div className="max-w-lg mx-auto px-4 py-8 space-y-4">
        <Helmet>
          <title>NAPIT Export | CertVoice</title>
        </Helmet>
        <div className="flex items-center gap-3">
          <Link
            to={id ? `/inspect/${id}` : '/dashboard'}
            className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                       text-certvoice-muted hover:text-certvoice-text transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-sm font-bold text-certvoice-text flex items-center gap-2">
            <Zap className="w-4 h-4 text-certvoice-accent" />
            NAPIT Notification
          </h1>
        </div>

        <div className="cv-panel border-certvoice-accent/30 bg-certvoice-accent/5 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-certvoice-accent shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-certvoice-text">
                EICR — No notification required
              </p>
              <p className="text-xs text-certvoice-muted leading-relaxed">
                Electrical Installation Condition Reports (EICRs) do not require Part P
                notification to NAPIT, NICEIC, or Building Control. The PDF report goes
                directly to the client.
              </p>
              <p className="text-xs text-certvoice-muted leading-relaxed">
                Only new electrical work (EIC certificates and notifiable Minor Works)
                requires Part P notification through your scheme provider.
              </p>
            </div>
          </div>
        </div>

        <Link
          to={id ? `/inspect/${id}` : '/dashboard'}
          className="cv-btn-secondary inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to certificate
        </Link>
      </div>
    )
  }

  // ============================================================
  // RENDER: ERROR
  // ============================================================

  if (pageState === 'error') {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-certvoice-red mx-auto" />
        <p className="text-sm text-certvoice-red">{loadError ?? 'Something went wrong'}</p>
        <Link to="/dashboard" className="cv-btn-secondary inline-block">Back to Dashboard</Link>
      </div>
    )
  }

  // ============================================================
  // RENDER: READY
  // ============================================================

  const address = certificate.installationDetails?.installationAddress ?? 'Certificate'

  return (
    <>
      <Helmet>
        <title>NAPIT Export | CertVoice</title>
        <meta name="description" content="Export certificate data for NAPIT Online notification" />
      </Helmet>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* ---- Sticky Header ---- */}
        <div className="sticky top-0 z-10 bg-certvoice-bg/95 backdrop-blur-sm pb-3 -mx-4 px-4 pt-4 border-b border-certvoice-border">
          <div className="flex items-center gap-3">
            <Link
              to={id ? `/inspect/${id}` : '/dashboard'}
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-text transition-colors"
              title="Back to certificate"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-bold text-certvoice-text truncate flex items-center gap-2">
                <Zap className="w-4 h-4 text-certvoice-accent shrink-0" />
                NAPIT Notification
              </h1>
              <p className="text-[10px] text-certvoice-muted truncate">{address}</p>
            </div>
            <button
              type="button"
              onClick={handleCopyAll}
              className="cv-btn-primary flex items-center gap-1.5 text-xs px-3 py-2"
            >
              {copiedSections.has('all') ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedSections.has('all') ? 'Copied!' : 'Copy All'}
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-certvoice-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-certvoice-accent rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] text-certvoice-muted whitespace-nowrap">
              {copiedCount}/{copyableSections.length} copied
            </span>
          </div>
        </div>

        {/* ---- NAPIT Portal Link ---- */}
        <a
          href="https://www.napitonline.co.uk"
          target="_blank"
          rel="noopener noreferrer"
          className="cv-panel flex items-center gap-3 p-3 hover:border-certvoice-accent/50 transition-colors"
        >
          <ExternalLink className="w-4 h-4 text-certvoice-accent shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-certvoice-text">Open NAPIT Online</p>
            <p className="text-[10px] text-certvoice-muted">napitonline.co.uk — log in and start a new notification</p>
          </div>
        </a>

        {/* ---- Info Banner ---- */}
        <div className="cv-panel border-certvoice-accent/20 bg-certvoice-accent/5 p-3">
          <p className="text-[10px] text-certvoice-muted leading-relaxed">
            Copy each section below and paste into the matching fields on NAPIT Online.
            Edit the NAPIT-specific fields (membership number, work category) before copying.
          </p>
        </div>

        {/* ---- NAPIT-Specific Editable Fields ---- */}
        <div className="cv-panel p-3 space-y-3">
          <p className="text-xs font-semibold text-certvoice-text">NAPIT Fields</p>

          <div className="space-y-2">
            <label className="block">
              <span className="text-[10px] text-certvoice-muted">NAPIT Membership Number</span>
              <input
                type="text"
                value={napitFields.napitMembershipNo}
                onChange={(e) => updateField('napitMembershipNo', e.target.value)}
                placeholder="e.g. NAPIT/12345"
                className="mt-1 w-full bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2
                           text-sm text-certvoice-text placeholder:text-certvoice-muted/40
                           focus:outline-none focus:border-certvoice-accent"
              />
            </label>

            <label className="block">
              <span className="text-[10px] text-certvoice-muted">Certificate Serial Number</span>
              <input
                type="text"
                value={napitFields.certificateSerial}
                onChange={(e) => updateField('certificateSerial', e.target.value)}
                placeholder="Pre-filled from certificate"
                className="mt-1 w-full bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2
                           text-sm text-certvoice-text placeholder:text-certvoice-muted/40
                           focus:outline-none focus:border-certvoice-accent"
              />
            </label>

            <label className="block">
              <span className="text-[10px] text-certvoice-muted">Work Category</span>
              <select
                value={napitFields.workCategory}
                onChange={(e) => updateField('workCategory', e.target.value)}
                className="mt-1 w-full bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2
                           text-sm text-certvoice-text focus:outline-none focus:border-certvoice-accent"
              >
                {WORK_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[10px] text-certvoice-muted">Description of Work</span>
              <textarea
                value={napitFields.workDescription}
                onChange={(e) => updateField('workDescription', e.target.value)}
                rows={2}
                placeholder="Brief description of electrical work carried out"
                className="mt-1 w-full bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2
                           text-sm text-certvoice-text placeholder:text-certvoice-muted/40
                           focus:outline-none focus:border-certvoice-accent resize-none"
              />
            </label>

            <label className="block">
              <span className="text-[10px] text-certvoice-muted">Date of Completion</span>
              <input
                type="date"
                value={napitFields.completionDate}
                onChange={(e) => updateField('completionDate', e.target.value)}
                className="mt-1 w-full bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2
                           text-sm text-certvoice-text focus:outline-none focus:border-certvoice-accent"
              />
            </label>
          </div>
        </div>

        {/* ---- Copyable Sections ---- */}
        {copyableSections.map((section) => {
          const isExpanded = expandedSections.has(section.id)
          const isCopied = copiedSections.has(section.id)
          const formatted = section.format(certificate, napitFields)

          return (
            <div key={section.id} className="cv-panel overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center justify-between p-3 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-certvoice-text">{section.title}</span>
                  {isCopied && (
                    <span className="text-[9px] text-certvoice-green font-semibold flex items-center gap-0.5">
                      <Check className="w-2.5 h-2.5" /> Copied
                    </span>
                  )}
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-certvoice-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-certvoice-muted" />
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-certvoice-border p-3 space-y-2">
                  <pre className="text-xs text-certvoice-text font-mono whitespace-pre-wrap leading-relaxed bg-certvoice-surface-2 rounded-lg p-3">
                    {formatted || '(No data)'}
                  </pre>
                  <button
                    type="button"
                    onClick={() => handleCopy(section.id, formatted)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      isCopied
                        ? 'bg-certvoice-green/15 text-certvoice-green'
                        : 'bg-certvoice-accent/15 text-certvoice-accent hover:bg-certvoice-accent/25'
                    }`}
                  >
                    {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {isCopied ? 'Copied!' : 'Copy section'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
