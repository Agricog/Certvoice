/**
 * CertVoice — NAPIT Notification Export
 *
 * Structured copy-paste interface for NAPIT Online portal notifications.
 * NAPIT has NO public API — this is a "smart clipboard" approach matching
 * the portal field order so electricians can copy each field individually
 * and paste directly into napitonline.co.uk.
 *
 * NOTE: Only EIC and notifiable Minor Works require Part P notification.
 * EICRs do NOT require notification to NAPIT/Building Control.
 *
 * @module pages/NapitExport
 */

import { useState, useEffect, useCallback } from 'react'
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
  MapPin,
  User,
  Calendar,
  FileText,
  Mail,
  Hash,
} from 'lucide-react'
import { getCertificate } from '../services/offlineStore'
import { captureError } from '../utils/errorTracking'
import type { EICRCertificate } from '../types/eicr'

// ============================================================
// TYPES
// ============================================================

type CertType = 'eicr' | 'eic' | 'minorworks'
type PageState = 'loading' | 'ready' | 'error' | 'not-applicable'
type DeliveryMethod = 'electronic' | 'postal'
type CopyState = Record<string, 'idle' | 'copied'>

interface NapitFields {
  napitMembershipNo: string
  certificateSerial: string
  workCategory: string
  workDescription: string
  completionDate: string
  customerEmail: string
  numberOfAccessories: string
  deliveryMethod: DeliveryMethod
}

// ============================================================
// WORK CATEGORIES (NAPIT Part P notification — Works Bar)
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
// ANALYTICS HELPER
// ============================================================

function trackNapitEvent(action: string, label?: string): void {
  try {
    if (typeof window !== 'undefined' && 'gtag' in window) {
      const w = window as unknown as { gtag: (...args: unknown[]) => void }
      w.gtag('event', action, { event_category: 'napit_export', event_label: label })
    }
  } catch {
    // Analytics must never break functionality
  }
}

// ============================================================
// HELPERS
// ============================================================

function extractPostcode(address?: string | null): string {
  if (!address) return ''
  const match = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)
  return match ? match[0].toUpperCase() : ''
}

function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
  } catch {
    return iso
  }
}

// ============================================================
// COMPONENT: FieldRow — individual copy row per NAPIT portal field
// ============================================================

function FieldRow({
  fieldId,
  label,
  value,
  hint,
  icon: Icon,
  copyState,
  onCopy,
  empty,
}: {
  fieldId: string
  label: string
  value: string
  hint?: string
  icon?: React.ElementType
  copyState: CopyState
  onCopy: (fieldId: string, value: string) => void
  empty?: boolean
}) {
  const isCopied = copyState[fieldId] === 'copied'
  const IconEl = Icon ?? Hash

  return (
    <div className={`flex items-start gap-3 px-3 py-3 transition-colors ${isCopied ? 'bg-certvoice-green/5' : ''}`}>
      <IconEl className={`w-4 h-4 mt-0.5 shrink-0 ${isCopied ? 'text-certvoice-green' : 'text-certvoice-muted'}`} />

      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-certvoice-muted uppercase tracking-wider mb-0.5">
          {label}
        </div>
        {empty ? (
          <div className="text-xs text-certvoice-muted/50 italic">Not set — enter manually in portal</div>
        ) : (
          <div className="text-sm text-certvoice-text font-mono break-words leading-relaxed">{value}</div>
        )}
        {hint && <div className="text-[10px] text-certvoice-muted/60 mt-0.5 leading-relaxed">{hint}</div>}
      </div>

      {!empty && (
        <button
          onClick={() => onCopy(fieldId, value)}
          className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
            transition-all duration-200 active:scale-95
            ${isCopied
              ? 'bg-certvoice-green/15 text-certvoice-green'
              : 'bg-certvoice-accent/15 text-certvoice-accent hover:bg-certvoice-accent/25'
            }`}
          aria-label={isCopied ? 'Copied' : `Copy ${label}`}
        >
          {isCopied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
        </button>
      )}
    </div>
  )
}

// ============================================================
// COMPONENT: CollapsibleSection
// ============================================================

function CollapsibleSection({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  id: string
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="cv-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center justify-between p-3 text-left"
        aria-expanded={isOpen}
        aria-controls={`section-${id}`}
      >
        <span className="text-xs font-semibold text-certvoice-text">{title}</span>
        {isOpen
          ? <ChevronUp className="w-4 h-4 text-certvoice-muted" />
          : <ChevronDown className="w-4 h-4 text-certvoice-muted" />}
      </button>

      {isOpen && (
        <div id={`section-${id}`} className="border-t border-certvoice-border divide-y divide-certvoice-border/50">
          {children}
        </div>
      )}
    </div>
  )
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function NapitExport() {
  const { certType, id } = useParams<{ certType: string; id: string }>()
  const resolvedType = (certType ?? 'eic') as CertType

  // --- State ---
  const [pageState, setPageState] = useState<PageState>('loading')
  const [certificate, setCertificate] = useState<Partial<EICRCertificate>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<CopyState>({})

  // --- Editable NAPIT fields ---
  const [napitFields, setNapitFields] = useState<NapitFields>({
    napitMembershipNo: '',
    certificateSerial: '',
    workCategory: WORK_CATEGORIES[0],
    workDescription: '',
    completionDate: '',
    customerEmail: '',
    numberOfAccessories: '',
    deliveryMethod: 'electronic',
  })

  const updateField = useCallback(<K extends keyof NapitFields>(key: K, value: NapitFields[K]) => {
    setNapitFields((prev) => ({ ...prev, [key]: value }))
  }, [])

  // ============================================================
  // LOAD
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

  const handleCopy = useCallback(async (fieldId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState((prev) => ({ ...prev, [fieldId]: 'copied' }))
      trackNapitEvent('field_copied', fieldId)

      setTimeout(() => {
        setCopyState((prev) => ({ ...prev, [fieldId]: 'idle' }))
      }, 3000)
    } catch (err) {
      captureError(err, 'NapitExport.handleCopy')
    }
  }, [])

  // ============================================================
  // DERIVED VALUES
  // ============================================================

  const installationAddress = certificate.installationDetails?.installationAddress ?? ''
  const postcode = extractPostcode(installationAddress)
  const clientName = certificate.clientDetails?.clientName ?? ''
  const engineerName = certificate.declaration?.inspectorName ?? ''
  const dateDisplay = fmtDate(napitFields.completionDate || certificate.declaration?.dateInspected)

  const readyToNotify =
    !!installationAddress &&
    !!postcode &&
    !!clientName &&
    !!napitFields.workCategory &&
    !!dateDisplay &&
    !!napitFields.certificateSerial

  // Progress — mandatory fields copied
  const MANDATORY = ['address', 'postcode', 'clientName', 'workCategory', 'completionDate', 'certificateSerial']
  const copiedCount = MANDATORY.filter((f) => copyState[f] === 'copied').length
  const progressPct = Math.round((copiedCount / MANDATORY.length) * 100)

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
        <Helmet><title>NAPIT Export | CertVoice</title></Helmet>

        <div className="flex items-center gap-3">
          <Link
            to={id ? `/inspect/${id}` : '/dashboard'}
            className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                       text-certvoice-muted hover:text-certvoice-text transition-colors"
            aria-label="Back"
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
              <p className="text-sm font-semibold text-certvoice-text">EICR — No notification required</p>
              <p className="text-xs text-certvoice-muted leading-relaxed">
                Electrical Installation Condition Reports (EICRs) do not require Part P
                notification to NAPIT or Building Control. The PDF goes directly to the client.
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

  return (
    <>
      <Helmet>
        <title>NAPIT Export | CertVoice</title>
        <meta name="description" content="Export certificate data for NAPIT Part P notification" />
      </Helmet>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* ── Sticky header ── */}
        <div className="sticky top-0 z-10 bg-certvoice-bg/95 backdrop-blur-sm pb-3 -mx-4 px-4 pt-4 border-b border-certvoice-border">
          <div className="flex items-center gap-3">
            <Link
              to={id ? `/inspect/${id}` : '/dashboard'}
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-text transition-colors"
              aria-label="Back to certificate"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-bold text-certvoice-text truncate flex items-center gap-2">
                <Zap className="w-4 h-4 text-certvoice-accent shrink-0" />
                NAPIT Part P Notification
              </h1>
              <p className="text-[10px] text-certvoice-muted truncate">
                {installationAddress || clientName || 'Certificate'}
              </p>
            </div>
            <a
              href="https://www.napitonline.com"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackNapitEvent('portal_opened', resolvedType)}
              className={`cv-btn-primary flex items-center gap-1.5 text-xs px-3 py-2 ${!readyToNotify ? 'opacity-50' : ''}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open NAPIT
            </a>
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
              {copiedCount}/{MANDATORY.length} copied
            </span>
          </div>
        </div>

        {/* ── Info banner ── */}
        <div className="cv-panel border-certvoice-accent/20 bg-certvoice-accent/5 p-3">
          <div className="flex items-start gap-2.5">
            <ExternalLink className="w-4 h-4 text-certvoice-accent shrink-0 mt-0.5" />
            <p className="text-[10px] text-certvoice-muted leading-relaxed">
              Open NAPIT in another tab, then copy each field and paste directly into the portal.
              Your job data is already filled — no retyping needed.
            </p>
          </div>
        </div>

        {/* ── Readiness warning ── */}
        {!readyToNotify && (
          <div className="cv-panel border-certvoice-amber/25 bg-certvoice-amber/5 p-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-certvoice-amber shrink-0 mt-0.5" />
              <p className="text-[10px] text-certvoice-muted leading-relaxed">
                Fill in the NAPIT-specific fields below, then copy each portal field in order.
                Address, postcode, client name, work category, date, and certificate number are required.
              </p>
            </div>
          </div>
        )}

        {/* ── Section 1: NAPIT-specific editable fields ── */}
        <CollapsibleSection id="napit-fields" title="1 — NAPIT-Specific Fields" defaultOpen>
          <div className="p-3 space-y-3">
            <p className="text-[10px] text-certvoice-muted">
              These fields are not on your certificate — fill them in once before copying.
            </p>

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
              <span className="text-[10px] text-certvoice-muted">Work Category (Works Bar)</span>
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
              <span className="text-[10px] text-certvoice-muted">Number of Accessories (statistical)</span>
              <input
                type="number"
                value={napitFields.numberOfAccessories}
                onChange={(e) => updateField('numberOfAccessories', e.target.value)}
                placeholder="e.g. 12"
                min="0"
                inputMode="numeric"
                className="mt-1 w-32 bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2
                           text-sm text-certvoice-text placeholder:text-certvoice-muted/40
                           focus:outline-none focus:border-certvoice-accent"
              />
            </label>

            <div>
              <span className="text-[10px] text-certvoice-muted block mb-1.5">BRCC Delivery Method</span>
              <div className="flex gap-2">
                {(['electronic', 'postal'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => updateField('deliveryMethod', method)}
                    className={`flex-1 py-2 rounded-lg border text-xs font-semibold capitalize transition-all
                      ${napitFields.deliveryMethod === method
                        ? 'bg-certvoice-accent/15 border-certvoice-accent/40 text-certvoice-accent'
                        : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
                      }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
              {napitFields.deliveryMethod === 'electronic' && (
                <input
                  type="email"
                  value={napitFields.customerEmail}
                  onChange={(e) => updateField('customerEmail', e.target.value)}
                  placeholder="Customer email for BRCC delivery"
                  className="mt-2 w-full bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2
                             text-sm text-certvoice-text placeholder:text-certvoice-muted/40
                             focus:outline-none focus:border-certvoice-accent"
                />
              )}
              {napitFields.deliveryMethod === 'postal' && (
                <p className="text-[10px] text-certvoice-muted/60 mt-2 leading-relaxed">
                  NAPIT will post the BRCC to the installation address. Postal costs more credits than electronic.
                </p>
              )}
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Section 2: Portal fields — copy one by one ── */}
        <CollapsibleSection id="portal-fields" title="2 — Copy Fields into Portal" defaultOpen>

          {/* Operative note */}
          <div className="px-3 py-3">
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-certvoice-surface-2 border border-certvoice-border">
              <Info className="w-3.5 h-3.5 text-certvoice-muted shrink-0 mt-0.5" />
              <p className="text-[10px] text-certvoice-muted leading-relaxed">
                <span className="text-certvoice-text font-semibold">Operative</span> is
                auto-populated by NAPIT from your account login. Confirm it matches:{' '}
                <span className="text-certvoice-text font-mono">
                  {engineerName || 'Not set in profile'}
                </span>
              </p>
            </div>
          </div>

          <FieldRow
            fieldId="address"
            label="Property / Installation Address"
            value={installationAddress}
            hint="Full address — NAPIT verifies this against their records"
            icon={MapPin}
            copyState={copyState}
            onCopy={handleCopy}
            empty={!installationAddress}
          />
          <FieldRow
            fieldId="postcode"
            label="Postcode"
            value={postcode}
            hint="Determines which local authority receives the notification"
            icon={MapPin}
            copyState={copyState}
            onCopy={handleCopy}
            empty={!postcode}
          />
          <FieldRow
            fieldId="clientName"
            label="Customer / Householder Name"
            value={clientName}
            icon={User}
            copyState={copyState}
            onCopy={handleCopy}
            empty={!clientName}
          />
          <FieldRow
            fieldId="workCategory"
            label="Type of Work (Works Bar)"
            value={napitFields.workCategory}
            hint="Select matching option from the Works Bar dropdown in the portal"
            icon={Zap}
            copyState={copyState}
            onCopy={handleCopy}
            empty={!napitFields.workCategory}
          />
          <FieldRow
            fieldId="completionDate"
            label="Date of Completion"
            value={dateDisplay}
            hint="DD/MM/YYYY — use the calendar picker in the portal"
            icon={Calendar}
            copyState={copyState}
            onCopy={handleCopy}
            empty={!dateDisplay}
          />
          <FieldRow
            fieldId="certificateSerial"
            label="Certificate Number (EIC / MWC ref)"
            value={napitFields.certificateSerial}
            hint="Reference number from your CertVoice certificate"
            icon={FileText}
            copyState={copyState}
            onCopy={handleCopy}
            empty={!napitFields.certificateSerial}
          />
          {napitFields.numberOfAccessories && (
            <FieldRow
              fieldId="accessories"
              label="Number of Accessories"
              value={napitFields.numberOfAccessories}
              icon={Hash}
              copyState={copyState}
              onCopy={handleCopy}
            />
          )}
          {napitFields.deliveryMethod === 'electronic' && napitFields.customerEmail && (
            <FieldRow
              fieldId="customerEmail"
              label="Customer Email Address"
              value={napitFields.customerEmail}
              hint="BRCC will be emailed directly to your customer"
              icon={Mail}
              copyState={copyState}
              onCopy={handleCopy}
            />
          )}
          {napitFields.workDescription && (
            <FieldRow
              fieldId="workDescription"
              label="Description / Notes"
              value={napitFields.workDescription}
              icon={FileText}
              copyState={copyState}
              onCopy={handleCopy}
            />
          )}
        </CollapsibleSection>

        {/* ── Assessment consent notice ── */}
        <div className="cv-panel p-3">
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 text-certvoice-muted shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-certvoice-text mb-0.5">Assessment consent checkbox</p>
              <p className="text-[10px] text-certvoice-muted leading-relaxed">
                The NAPIT portal includes: "I consent to this job being used for my assessment."
                Tick this if you're happy for NAPIT to use this notification as part of your
                periodic assessment. Your choice — no preference either way.
              </p>
            </div>
          </div>
        </div>

        {/* ── Credit cost notice ── */}
        <div className="cv-panel border-certvoice-amber/25 p-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-certvoice-amber shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-certvoice-text mb-0.5">Notification credits</p>
              <p className="text-[10px] text-certvoice-muted leading-relaxed">
                Each Part P submission uses one NAPIT credit (~£2.20 + VAT). Ensure you have
                credits loaded before submitting. NAPIT requires notification within 21 days
                of completion — the statutory deadline is 30 days.
              </p>
            </div>
          </div>
        </div>

        {/* ── Footer CTA ── */}
        <div className="pt-2 pb-10 text-center space-y-3">
          {readyToNotify ? (
            
              href="https://www.napitonline.com"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackNapitEvent('portal_opened_footer', resolvedType)}
              className="inline-flex items-center gap-2 cv-btn-primary px-6 py-3"
            >
              <ExternalLink className="w-4 h-4" />
              Open NAPIT Portal
            </a>
          ) : (
            <Link
              to={id ? `/eic/${id}` : '/dashboard'}
              className="inline-flex items-center gap-2 cv-btn-primary px-6 py-3"
            >
              <ArrowLeft className="w-4 h-4" />
              Complete required fields first
            </Link>
          )}
          <div className="space-y-1">
            <p className="text-[10px] text-certvoice-muted">
              CertVoice does not submit to NAPIT on your behalf. You remain in full control of the submission.
            </p>
            <Link
              to={id ? `/eic/${id}` : '/dashboard'}
              className="text-xs text-certvoice-accent hover:underline underline-offset-2"
            >
              Back to certificate
            </Link>
          </div>
        </div>

      </div>
    </>
  )
}
