/**
 * CertVoice — PDFPreview Component
 *
 * Final gate between captured data and a legally compliant BS 7671 certificate.
 * Calls pdf-generate Cloudflare Worker, renders preview in iframe, provides
 * download / email / share actions.
 *
 * Placement: Modal overlay triggered from CertificateReview page.
 * Actions: Download PDF, Email to Client (Resend), Share (Web Share API)
 *
 * @module components/PDFPreview
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Helmet } from 'react-helmet-async'
import {
  X,
  Download,
  Mail,
  Share2,
  ArrowLeft,
  FileText,
  CheckCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Send,
  WifiOff,
} from 'lucide-react'
import type { EICRCertificate, ClassificationCode } from '../types/eicr'
import { validateInput } from '../utils/validation'
import { sanitizeText } from '../utils/sanitization'
import { captureError } from '../utils/errorTracking'

// ============================================================
// TYPES
// ============================================================

interface PDFPreviewProps {
  certificate: EICRCertificate
  onClose: () => void
  onBackToReview: () => void
}

type GenerationState = 'idle' | 'generating' | 'ready' | 'error' | 'offline'

interface EmailState {
  isOpen: boolean
  email: string
  clientName: string
  sending: boolean
  sent: boolean
  error: string | null
}

// ============================================================
// CONSTANTS
// ============================================================

const PDF_WORKER_URL = import.meta.env.VITE_PDF_WORKER_URL ?? '/api/pdf/generate'
const EMAIL_API_URL = '/api/email/certificate'

// ============================================================
// ANALYTICS HELPERS
// ============================================================

function trackPdfEvent(
  action: string,
  data: Record<string, string | number | boolean> = {}
): void {
  try {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).gtag) {
      const gtag = (window as unknown as Record<string, unknown>).gtag as (
        command: string,
        action: string,
        params: Record<string, string | number | boolean>
      ) => void
      gtag('event', action, {
        event_category: 'pdf',
        ...data,
      })
    }
  } catch {
    // Analytics should never break the app
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function PDFPreview({
  certificate,
  onClose,
  onBackToReview,
}: PDFPreviewProps) {
  // --- State ---
  const [generationState, setGenerationState] = useState<GenerationState>('idle')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [generationTime, setGenerationTime] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')

  const [emailState, setEmailState] = useState<EmailState>({
    isOpen: false,
    email: '',
    clientName: certificate.clientDetails?.clientName ?? '',
    sending: false,
    sent: false,
    error: null,
  })

  const [emailValidationError, setEmailValidationError] = useState<string>('')

  const blobUrlRef = useRef<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // --- Derived ---
  const assessment = certificate.summaryOfCondition?.overallAssessment ?? 'UNSATISFACTORY'
  const isSatisfactory = assessment === 'SATISFACTORY'
  const reportNumber = certificate.reportNumber ?? ''
  const address = certificate.installationDetails?.installationAddress ?? 'Unknown Address'

  const hasC1 = (certificate.observations ?? []).some(
    (o) => o.classificationCode === ('C1' as ClassificationCode)
  )
  const hasC2 = (certificate.observations ?? []).some(
    (o) => o.classificationCode === ('C2' as ClassificationCode)
  )

  const observationCounts = (certificate.observations ?? []).reduce(
    (acc, o) => {
      if (o.classificationCode) {
        acc[o.classificationCode] = (acc[o.classificationCode] ?? 0) + 1
      }
      return acc
    },
    {} as Record<string, number>
  )

  const filename = `EICR-${reportNumber}-${address
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60)}.pdf`

  // --- Cleanup blob URL on unmount ---
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      abortControllerRef.current?.abort()
    }
  }, [])

  // --- Auto-generate on mount ---
  useEffect(() => {
    generatePdf()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ============================================================
  // PDF GENERATION
  // ============================================================

  const generatePdf = useCallback(async () => {
    // Check online status
    if (!navigator.onLine) {
      setGenerationState('offline')
      return
    }

    // Revoke previous blob
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
      setBlobUrl(null)
    }

    setGenerationState('generating')
    setErrorMessage('')
    setPageCount(null)
    setGenerationTime(null)

    const startTime = performance.now()
    abortControllerRef.current = new AbortController()

    try {
      const response = await fetch(PDF_WORKER_URL, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          certificate,
          options: {
            includePhotos: false,
            companyLogo: null,
            outputFormat: 'buffer',
          },
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const msg = (errorData as Record<string, string> | null)?.error ?? 'PDF generation failed'
        throw new Error(msg)
      }

      const blob = await response.blob()

      if (blob.size < 500) {
        throw new Error('Generated PDF appears to be empty')
      }

      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url
      setBlobUrl(url)

      // Estimate page count from file size (rough: ~15KB per page for text-heavy PDFs)
      const estimatedPages = Math.max(1, Math.round(blob.size / 15000))
      setPageCount(estimatedPages)

      const elapsed = Math.round(performance.now() - startTime)
      setGenerationTime(elapsed)

      setGenerationState('ready')

      trackPdfEvent('pdf_generated', {
        report_number: reportNumber,
        page_count: estimatedPages,
        generation_time_ms: elapsed,
        file_size_bytes: blob.size,
        assessment,
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') return

      captureError(error, 'PDFPreview.generatePdf')
      setGenerationState('error')
      setErrorMessage(
        error instanceof Error ? error.message : 'PDF generation failed. Please try again.'
      )

      trackPdfEvent('pdf_generation_failed', {
        report_number: reportNumber,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
  }, [certificate, reportNumber, assessment])

  // ============================================================
  // DOWNLOAD
  // ============================================================

  const handleDownload = useCallback(() => {
    if (!blobUrl) return

    try {
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      trackPdfEvent('pdf_downloaded', { report_number: reportNumber })
    } catch (error) {
      captureError(error, 'PDFPreview.handleDownload')
    }
  }, [blobUrl, filename, reportNumber])

  // ============================================================
  // EMAIL
  // ============================================================

  const handleEmailChange = useCallback((value: string) => {
    setEmailState((prev) => ({ ...prev, email: value, error: null }))

    const result = validateInput(value, 'email', 255)
    if (value && !result.isValid) {
      setEmailValidationError(Object.values(result.errors)[0] ?? 'Invalid email')
    } else {
      setEmailValidationError('')
    }
  }, [])

  const handleSendEmail = useCallback(async () => {
    const { email, clientName } = emailState

    // Validate
    const emailResult = validateInput(email, 'email', 255)
    if (!emailResult.isValid) {
      setEmailValidationError(Object.values(emailResult.errors)[0] ?? 'Invalid email')
      return
    }

    if (!blobUrl) return

    setEmailState((prev) => ({ ...prev, sending: true, error: null }))

    try {
      // Convert blob to base64 for API
      const response = await fetch(blobUrl)
      const blob = await response.blob()
      const reader = new FileReader()

      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1] ?? '')
        }
        reader.onerror = () => reject(new Error('Failed to read PDF'))
        reader.readAsDataURL(blob)
      })

      const sanitisedName = sanitizeText(clientName) ?? clientName

      const emailResponse = await fetch(EMAIL_API_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          clientName: sanitisedName,
          reportNumber,
          address,
          assessment,
          pdfBase64: base64,
          filename,
        }),
      })

      if (!emailResponse.ok) {
        throw new Error('Failed to send email')
      }

      setEmailState((prev) => ({ ...prev, sending: false, sent: true }))

      trackPdfEvent('pdf_emailed', { report_number: reportNumber })
    } catch (error) {
      captureError(error, 'PDFPreview.handleSendEmail')
      setEmailState((prev) => ({
        ...prev,
        sending: false,
        error: 'Failed to send email. Please try again.',
      }))
    }
  }, [emailState, blobUrl, reportNumber, address, assessment, filename])

  // ============================================================
  // SHARE (Web Share API)
  // ============================================================

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const handleShare = useCallback(async () => {
    if (!blobUrl) return

    try {
      const response = await fetch(blobUrl)
      const blob = await response.blob()
      const file = new File([blob], filename, { type: 'application/pdf' })

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `EICR Report ${reportNumber}`,
          text: `Electrical Installation Condition Report for ${address}`,
          files: [file],
        })
        trackPdfEvent('pdf_shared', { report_number: reportNumber, method: 'web_share' })
      } else {
        // Fallback: download
        handleDownload()
      }
    } catch (error) {
      // User cancelled share — not an error
      if ((error as Error).name !== 'AbortError') {
        captureError(error, 'PDFPreview.handleShare')
      }
    }
  }, [blobUrl, filename, reportNumber, address, handleDownload])

  // ============================================================
  // RENDER: LOADING STATE
  // ============================================================

  const renderGenerating = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="relative mb-6">
        <div className="w-16 h-16 rounded-2xl bg-certvoice-accent/10 flex items-center justify-center">
          <FileText className="w-8 h-8 text-certvoice-accent" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-certvoice-surface border-2 border-certvoice-border flex items-center justify-center">
          <Loader2 className="w-3.5 h-3.5 text-certvoice-accent animate-spin" />
        </div>
      </div>
      <h2 className="text-base font-bold text-certvoice-text mb-1">
        Generating Certificate
      </h2>
      <p className="text-xs text-certvoice-muted max-w-xs">
        Building BS 7671:2018+A2:2022 compliant EICR for{' '}
        <span className="text-certvoice-text font-medium">{address}</span>
      </p>
      <div className="mt-6 w-48 h-1.5 bg-certvoice-surface-2 rounded-full overflow-hidden">
        <div className="h-full bg-certvoice-accent rounded-full animate-pulse" style={{ width: '60%' }} />
      </div>
      <p className="text-[10px] text-certvoice-muted/60 mt-3">
        This may take a few seconds
      </p>
    </div>
  )

  // ============================================================
  // RENDER: ERROR STATE
  // ============================================================

  const renderError = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-certvoice-red/10 flex items-center justify-center mb-4">
        <AlertTriangle className="w-7 h-7 text-certvoice-red" />
      </div>
      <h2 className="text-base font-bold text-certvoice-text mb-1">
        Generation Failed
      </h2>
      <p className="text-xs text-certvoice-muted max-w-xs mb-6">
        {errorMessage || 'Something went wrong generating the PDF. Please try again.'}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBackToReview}
          className="px-4 py-2 rounded-lg border border-certvoice-border text-xs font-semibold
                     text-certvoice-muted hover:text-certvoice-text transition-colors"
        >
          Back to Review
        </button>
        <button
          type="button"
          onClick={generatePdf}
          className="cv-btn-primary px-4 py-2 flex items-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    </div>
  )

  // ============================================================
  // RENDER: OFFLINE STATE
  // ============================================================

  const renderOffline = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-certvoice-amber/10 flex items-center justify-center mb-4">
        <WifiOff className="w-7 h-7 text-certvoice-amber" />
      </div>
      <h2 className="text-base font-bold text-certvoice-text mb-1">
        You're Offline
      </h2>
      <p className="text-xs text-certvoice-muted max-w-xs mb-2">
        PDF will be generated when you're back online. Your certificate data is safely saved.
      </p>
      <button
        type="button"
        onClick={() => {
          if (navigator.onLine) {
            generatePdf()
          }
        }}
        className="mt-4 cv-btn-primary px-4 py-2 flex items-center gap-2"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Check Connection
      </button>
    </div>
  )

  // ============================================================
  // RENDER: EMAIL MODAL
  // ============================================================

  const renderEmailPanel = () => (
    <div className="absolute inset-0 z-20 bg-certvoice-bg/95 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md bg-certvoice-surface border border-certvoice-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-certvoice-text flex items-center gap-2">
            <Mail className="w-4 h-4 text-certvoice-accent" />
            Email Certificate
          </h3>
          <button
            type="button"
            onClick={() => setEmailState((prev) => ({ ...prev, isOpen: false, error: null }))}
            className="w-7 h-7 rounded-lg border border-certvoice-border flex items-center justify-center
                       text-certvoice-muted hover:text-certvoice-text transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {emailState.sent ? (
          <div className="text-center py-4">
            <CheckCircle className="w-10 h-10 text-certvoice-green mx-auto mb-2" />
            <p className="text-sm font-semibold text-certvoice-text">Email Sent</p>
            <p className="text-xs text-certvoice-muted mt-1">
              Certificate sent to {emailState.email}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label htmlFor="email-recipient" className="block text-xs font-medium text-certvoice-muted mb-1">
                  Recipient Email
                </label>
                <input
                  id="email-recipient"
                  type="email"
                  value={emailState.email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full px-3 py-2 rounded-lg border border-certvoice-border bg-certvoice-bg
                             text-sm text-certvoice-text placeholder-certvoice-muted/40
                             focus:outline-none focus:ring-2 focus:ring-certvoice-accent/40 focus:border-certvoice-accent
                             transition-colors"
                  aria-invalid={emailValidationError ? 'true' : 'false'}
                  aria-describedby={emailValidationError ? 'email-error' : undefined}
                  disabled={emailState.sending}
                  autoComplete="email"
                />
                {emailValidationError && (
                  <p id="email-error" className="text-xs text-certvoice-red mt-1" role="alert">
                    {emailValidationError}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="email-client-name" className="block text-xs font-medium text-certvoice-muted mb-1">
                  Client Name
                </label>
                <input
                  id="email-client-name"
                  type="text"
                  value={emailState.clientName}
                  onChange={(e) =>
                    setEmailState((prev) => ({ ...prev, clientName: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-lg border border-certvoice-border bg-certvoice-bg
                             text-sm text-certvoice-text
                             focus:outline-none focus:ring-2 focus:ring-certvoice-accent/40 focus:border-certvoice-accent
                             transition-colors"
                  disabled={emailState.sending}
                />
              </div>
            </div>

            <div className="text-[10px] text-certvoice-muted bg-certvoice-surface-2 rounded-lg p-3">
              The certificate will be sent as a PDF attachment with a standard covering message
              including the report number ({reportNumber}) and property address.
            </div>

            {emailState.error && (
              <p className="text-xs text-certvoice-red" role="alert">
                {emailState.error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSendEmail}
              disabled={emailState.sending || !emailState.email || !!emailValidationError}
              className="cv-btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {emailState.sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Certificate
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )

  // ============================================================
  // RENDER: MAIN
  // ============================================================

  return (
    <>
      <Helmet>
        <title>PDF Preview — {reportNumber} | CertVoice</title>
        <meta name="description" content="Preview and download your EICR certificate" />
      </Helmet>

      <div className="fixed inset-0 z-50 bg-certvoice-bg flex flex-col">
        {/* ---- HEADER ---- */}
        <div className="shrink-0 border-b border-certvoice-border bg-certvoice-surface px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            {/* Back / Close */}
            <button
              type="button"
              onClick={generationState === 'ready' ? onClose : onBackToReview}
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-text transition-colors"
              aria-label="Close preview"
            >
              {generationState === 'ready' ? (
                <X className="w-4 h-4" />
              ) : (
                <ArrowLeft className="w-4 h-4" />
              )}
            </button>

            {/* Report info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-certvoice-text truncate">
                {reportNumber}
              </h1>
              <p className="text-[10px] text-certvoice-muted truncate">
                {address}
              </p>
            </div>

            {/* Assessment badge */}
            <div
              className={`shrink-0 px-3 py-1 rounded-lg text-[10px] font-bold ${
                isSatisfactory
                  ? 'bg-certvoice-green/15 text-certvoice-green border border-certvoice-green/30'
                  : 'bg-certvoice-red/15 text-certvoice-red border border-certvoice-red/30'
              }`}
            >
              {assessment}
            </div>
          </div>

          {/* C1 Warning Banner */}
          {hasC1 && generationState === 'ready' && (
            <div className="max-w-4xl mx-auto mt-2 flex items-center gap-2 bg-certvoice-red/10 border border-certvoice-red/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-certvoice-red shrink-0" />
              <p className="text-[10px] text-certvoice-red font-semibold">
                C1 (Danger Present) observations found. The client must be advised of immediate danger.
              </p>
            </div>
          )}

          {/* C2 Warning Banner */}
          {!hasC1 && hasC2 && generationState === 'ready' && (
            <div className="max-w-4xl mx-auto mt-2 flex items-center gap-2 bg-certvoice-amber/10 border border-certvoice-amber/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-certvoice-amber shrink-0" />
              <p className="text-[10px] text-certvoice-amber font-semibold">
                C2 (Potentially Dangerous) observations found. Urgent remedial action required.
              </p>
            </div>
          )}
        </div>

        {/* ---- CONTENT ---- */}
        <div className="flex-1 relative overflow-hidden">
          {generationState === 'generating' && renderGenerating()}
          {generationState === 'error' && renderError()}
          {generationState === 'offline' && renderOffline()}

          {generationState === 'ready' && blobUrl && (
            <>
              {/* Info bar */}
              <div className="shrink-0 bg-certvoice-surface-2 border-b border-certvoice-border px-4 py-2">
                <div className="max-w-4xl mx-auto flex items-center gap-4 text-[10px] text-certvoice-muted">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-certvoice-green" />
                    <span className="text-certvoice-green font-semibold">BS 7671:2018+A2:2022</span>
                  </span>
                  {pageCount && (
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      ~{pageCount} pages
                    </span>
                  )}
                  {generationTime && (
                    <span className="hidden sm:block">
                      Generated in {generationTime < 1000 ? `${generationTime}ms` : `${(generationTime / 1000).toFixed(1)}s`}
                    </span>
                  )}

                  {/* Observation summary */}
                  {Object.keys(observationCounts).length > 0 && (
                    <div className="ml-auto flex items-center gap-2">
                      {(Object.entries(observationCounts) as Array<[string, number]>).map(([code, count]) => (
                        <span
                          key={code}
                          className={`font-bold ${
                            code === 'C1'
                              ? 'text-certvoice-red'
                              : code === 'C2'
                                ? 'text-certvoice-amber'
                                : code === 'C3'
                                  ? 'text-certvoice-accent'
                                  : 'text-certvoice-muted'
                          }`}
                        >
                          {code}: {count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* PDF iframe */}
              <iframe
                ref={iframeRef}
                src={`${blobUrl}#toolbar=1&navpanes=0`}
                title={`EICR Preview — ${reportNumber}`}
                className="w-full flex-1"
                style={{ height: 'calc(100vh - 200px)', minHeight: '400px' }}
                sandbox="allow-same-origin"
              />
            </>
          )}

          {/* Email panel overlay */}
          {emailState.isOpen && renderEmailPanel()}
        </div>

        {/* ---- ACTION BAR ---- */}
        {generationState === 'ready' && (
          <div className="shrink-0 border-t border-certvoice-border bg-certvoice-surface px-4 py-3">
            <div className="max-w-4xl mx-auto flex items-center gap-3">
              {/* Back to review */}
              <button
                type="button"
                onClick={onBackToReview}
                className="px-3 py-2 rounded-lg border border-certvoice-border text-xs font-semibold
                           text-certvoice-muted hover:text-certvoice-text hover:border-certvoice-muted
                           transition-colors flex items-center gap-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </button>

              <div className="flex-1" />

              {/* Share */}
              {canShare && (
                <button
                  type="button"
                  onClick={handleShare}
                  className="w-9 h-9 rounded-lg border border-certvoice-border flex items-center justify-center
                             text-certvoice-muted hover:text-certvoice-accent hover:border-certvoice-accent
                             transition-colors"
                  aria-label="Share certificate"
                >
                  <Share2 className="w-4 h-4" />
                </button>
              )}

              {/* Email */}
              <button
                type="button"
                onClick={() =>
                  setEmailState((prev) => ({ ...prev, isOpen: true, sent: false, error: null }))
                }
                className="px-4 py-2 rounded-lg border border-certvoice-border text-xs font-semibold
                           text-certvoice-muted hover:text-certvoice-accent hover:border-certvoice-accent
                           transition-colors flex items-center gap-2"
              >
                <Mail className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Email</span>
              </button>

              {/* Download */}
              <button
                type="button"
                onClick={handleDownload}
                className="cv-btn-primary px-4 py-2 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
