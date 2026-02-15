/**
 * CertVoice — Settings Page
 *
 * Pre-fill source for:
 *   - Section G: Declaration (inspector name, company, signature, reg number)
 *   - Schedule Headers: Test instrument serial numbers
 *
 * Sections:
 *   1. Engineer Profile (name, phone, email)
 *   2. Company Details (company name, address, logo)
 *   3. Registration Body (NICEIC / NAPIT / ELECSA / other + reg number)
 *   4. Digital Signature (canvas capture, saved as PNG to R2)
 *   5. Default Test Instruments (MFT serial, loop tester, RCD tester, etc.)
 *
 * Saves to Neon via /api/engineer/settings
 *
 * @module pages/Settings
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  ArrowLeft,
  Save,
  User,
  Building2,
  ShieldCheck,
  PenTool,
  Wrench,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Trash2,
  Undo2,
} from 'lucide-react'
import { validateInput } from '../utils/validation'
import { sanitizeText } from '../utils/sanitization'
import { captureError } from '../utils/errorTracking'

// ============================================================
// TYPES
// ============================================================

type RegistrationBody = 'NICEIC' | 'NAPIT' | 'ELECSA' | 'STROMA' | 'OTHER' | ''

interface EngineerSettings {
  // Profile
  fullName: string
  phone: string
  email: string

  // Company
  companyName: string
  companyAddress: string
  companyPhone: string
  companyEmail: string

  // Registration
  registrationBody: RegistrationBody
  registrationNumber: string
  qualifications: string

  // Signature
  signatureKey: string | null
  signatureDataUrl: string | null

  // Test Instruments
  mftSerial: string
  mftCalibrationDate: string
  loopTesterSerial: string
  loopTesterCalibrationDate: string
  rcdTesterSerial: string
  rcdTesterCalibrationDate: string
  irTesterSerial: string
  irTesterCalibrationDate: string
  continuityTesterSerial: string
  continuityTesterCalibrationDate: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// ============================================================
// DEFAULTS
// ============================================================

const EMPTY_SETTINGS: EngineerSettings = {
  fullName: '',
  phone: '',
  email: '',
  companyName: '',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  registrationBody: '',
  registrationNumber: '',
  qualifications: '',
  signatureKey: null,
  signatureDataUrl: null,
  mftSerial: '',
  mftCalibrationDate: '',
  loopTesterSerial: '',
  loopTesterCalibrationDate: '',
  rcdTesterSerial: '',
  rcdTesterCalibrationDate: '',
  irTesterSerial: '',
  irTesterCalibrationDate: '',
  continuityTesterSerial: '',
  continuityTesterCalibrationDate: '',
}

const REGISTRATION_BODIES: Array<{ value: RegistrationBody; label: string }> = [
  { value: '', label: 'Select registration body...' },
  { value: 'NICEIC', label: 'NICEIC' },
  { value: 'NAPIT', label: 'NAPIT' },
  { value: 'ELECSA', label: 'ELECSA' },
  { value: 'STROMA', label: 'Stroma' },
  { value: 'OTHER', label: 'Other' },
]

const API_URL = '/api/engineer/settings'

// ============================================================
// COMPONENT
// ============================================================

export default function Settings() {
  const { user } = useUser()

  // --- State ---
  const [settings, setSettings] = useState<EngineerSettings>(EMPTY_SETTINGS)
  const [loading, setLoading] = useState<boolean>(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [activeSection, setActiveSection] = useState<string>('profile')

  // Signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState<boolean>(false)
  const [hasSignature, setHasSignature] = useState<boolean>(false)

  // ---- Load settings on mount ----
  useEffect(() => {
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Pre-fill from Clerk user ----
  useEffect(() => {
    if (user && !settings.fullName && !settings.email) {
      setSettings((prev) => ({
        ...prev,
        fullName: prev.fullName || user.fullName || '',
        email: prev.email || user.primaryEmailAddress?.emailAddress || '',
        phone: prev.phone || user.primaryPhoneNumber?.phoneNumber || '',
      }))
    }
  }, [user, settings.fullName, settings.email])

  // ============================================================
  // API
  // ============================================================

  const loadSettings = async () => {
    setLoading(true)
    try {
      const response = await fetch(API_URL, {
        method: 'GET',
        credentials: 'include',
      })

      if (response.ok) {
        const data = (await response.json()) as Partial<EngineerSettings>
        setSettings((prev) => ({ ...prev, ...data }))

        if (data.signatureDataUrl) {
          setHasSignature(true)
          drawSignatureFromDataUrl(data.signatureDataUrl)
        }
      }
      // 404 is fine — new user, no settings yet
    } catch (error) {
      captureError(error, 'Settings.loadSettings')
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    // Validate required fields
    const newErrors: Record<string, string> = {}

    if (!settings.fullName.trim()) {
      newErrors.fullName = 'Full name is required'
    }

    const emailResult = validateInput(settings.email, 'email', 255)
    if (settings.email && !emailResult.isValid) {
      newErrors.email = Object.values(emailResult.errors)[0] ?? 'Invalid email'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setErrors({})
    setSaveState('saving')

    try {
      // Sanitise text fields
      const sanitised: EngineerSettings = {
        ...settings,
        fullName: sanitizeText(settings.fullName) ?? settings.fullName,
        companyName: sanitizeText(settings.companyName) ?? settings.companyName,
        companyAddress: sanitizeText(settings.companyAddress) ?? settings.companyAddress,
        qualifications: sanitizeText(settings.qualifications) ?? settings.qualifications,
      }

      // Extract signature data URL from canvas if drawn
      if (hasSignature && canvasRef.current) {
        sanitised.signatureDataUrl = canvasRef.current.toDataURL('image/png')
      }

      const response = await fetch(API_URL, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitised),
      })

      if (!response.ok) throw new Error('Failed to save settings')

      setSaveState('saved')

      // Track
      trackEvent('settings_saved')

      // Reset save indicator after 3s
      setTimeout(() => setSaveState('idle'), 3000)
    } catch (error) {
      captureError(error, 'Settings.saveSettings')
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 4000)
    }
  }

  // ============================================================
  // SIGNATURE CANVAS
  // ============================================================

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // High DPI support
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  useEffect(() => {
    initCanvas()

    const handleResize = () => {
      // Save current signature before resize
      const dataUrl = hasSignature && canvasRef.current
        ? canvasRef.current.toDataURL()
        : null

      initCanvas()

      // Restore signature after resize
      if (dataUrl) {
        drawSignatureFromDataUrl(dataUrl)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [initCanvas, hasSignature])

  const drawSignatureFromDataUrl = (dataUrl: string) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)
      ctx.drawImage(img, 0, 0, rect.width, rect.height)
      ctx.scale(1, 1) // Reset scale after drawImage
      ctx.scale(dpr, dpr) // Reapply DPI scale
    }
    img.src = dataUrl
  }

  const getCanvasPoint = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()

    if ('touches' in e) {
      const touch = e.touches[0]
      if (!touch) return { x: 0, y: 0 }
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
    }

    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleDrawStart = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return

    const point = getCanvasPoint(e)
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
    setIsDrawing(true)
    setHasSignature(true)
  }

  const handleDrawMove = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return

    const point = getCanvasPoint(e)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  }

  const handleDrawEnd = () => {
    setIsDrawing(false)
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    setHasSignature(false)
    setSettings((prev) => ({ ...prev, signatureKey: null, signatureDataUrl: null }))
  }

  // ============================================================
  // HELPERS
  // ============================================================

  const updateField = <K extends keyof EngineerSettings>(
    field: K,
    value: EngineerSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  const trackEvent = (action: string) => {
    try {
      if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).gtag) {
        const gtag = (window as unknown as Record<string, unknown>).gtag as (
          command: string,
          action: string,
          params: Record<string, string>
        ) => void
        gtag('event', action, { event_category: 'settings' })
      }
    } catch {
      // Never break for analytics
    }
  }

  // ============================================================
  // SECTION NAV
  // ============================================================

  const sections = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'registration', label: 'Registration', icon: ShieldCheck },
    { id: 'signature', label: 'Signature', icon: PenTool },
    { id: 'instruments', label: 'Instruments', icon: Wrench },
  ]

  // ============================================================
  // RENDER
  // ============================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-certvoice-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-certvoice-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading settings...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <Helmet>
        <title>Settings | CertVoice</title>
        <meta name="description" content="Configure your engineer profile, company details, and test instruments for CertVoice." />
      </Helmet>

      <div className="min-h-screen bg-certvoice-bg">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-certvoice-surface border-b border-certvoice-border px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <Link
              to="/"
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-text transition-colors"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>

            <h1 className="flex-1 text-sm font-bold text-certvoice-text">
              Settings
            </h1>

            <button
              type="button"
              onClick={saveSettings}
              disabled={saveState === 'saving'}
              className="cv-btn-primary px-4 py-2 flex items-center gap-2 disabled:opacity-50"
            >
              {saveState === 'saving' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving
                </>
              ) : saveState === 'saved' ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  Saved
                </>
              ) : saveState === 'error' ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Failed
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Save
                </>
              )}
            </button>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-6 space-y-2">
          {/* Section Nav */}
          <div className="flex gap-1 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  activeSection === id
                    ? 'bg-certvoice-accent/15 text-certvoice-accent border border-certvoice-accent/30'
                    : 'text-certvoice-muted hover:text-certvoice-text border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* ---- PROFILE ---- */}
          {activeSection === 'profile' && (
            <div className="cv-card space-y-4">
              <h2 className="text-sm font-bold text-certvoice-text flex items-center gap-2">
                <User className="w-4 h-4 text-certvoice-accent" />
                Engineer Profile
              </h2>
              <p className="text-[10px] text-certvoice-muted">
                Used in Section G (Declaration) on every certificate you issue.
              </p>

              <SettingsField
                label="Full Name"
                value={settings.fullName}
                onChange={(v) => updateField('fullName', v)}
                error={errors.fullName}
                required
                placeholder="e.g. John Smith"
              />
              <SettingsField
                label="Phone"
                value={settings.phone}
                onChange={(v) => updateField('phone', v)}
                type="tel"
                placeholder="e.g. 07700 900123"
              />
              <SettingsField
                label="Email"
                value={settings.email}
                onChange={(v) => updateField('email', v)}
                error={errors.email}
                type="email"
                placeholder="e.g. john@example.com"
              />
              <SettingsField
                label="Qualifications"
                value={settings.qualifications}
                onChange={(v) => updateField('qualifications', v)}
                placeholder="e.g. City & Guilds 2391, 18th Edition"
                hint="Listed on Section G of the certificate"
              />
            </div>
          )}

          {/* ---- COMPANY ---- */}
          {activeSection === 'company' && (
            <div className="cv-card space-y-4">
              <h2 className="text-sm font-bold text-certvoice-text flex items-center gap-2">
                <Building2 className="w-4 h-4 text-certvoice-accent" />
                Company Details
              </h2>
              <p className="text-[10px] text-certvoice-muted">
                Appears on the certificate cover page and declaration.
              </p>

              <SettingsField
                label="Company Name"
                value={settings.companyName}
                onChange={(v) => updateField('companyName', v)}
                placeholder="e.g. Smith Electrical Services Ltd"
              />
              <SettingsField
                label="Company Address"
                value={settings.companyAddress}
                onChange={(v) => updateField('companyAddress', v)}
                placeholder="e.g. 12 High Street, Manchester, M1 1AA"
                multiline
              />
              <SettingsField
                label="Company Phone"
                value={settings.companyPhone}
                onChange={(v) => updateField('companyPhone', v)}
                type="tel"
                placeholder="e.g. 0161 234 5678"
              />
              <SettingsField
                label="Company Email"
                value={settings.companyEmail}
                onChange={(v) => updateField('companyEmail', v)}
                type="email"
                placeholder="e.g. info@smithelectrical.co.uk"
              />
            </div>
          )}

          {/* ---- REGISTRATION ---- */}
          {activeSection === 'registration' && (
            <div className="cv-card space-y-4">
              <h2 className="text-sm font-bold text-certvoice-text flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-certvoice-accent" />
                Registration Body
              </h2>
              <p className="text-[10px] text-certvoice-muted">
                Your competent person scheme registration. Required for legally valid certificates.
              </p>

              <div className="space-y-1">
                <label htmlFor="reg-body" className="block text-xs font-medium text-certvoice-muted">
                  Registration Body
                </label>
                <select
                  id="reg-body"
                  value={settings.registrationBody}
                  onChange={(e) => updateField('registrationBody', e.target.value as RegistrationBody)}
                  className="w-full px-3 py-2 rounded-lg border border-certvoice-border bg-certvoice-bg
                             text-sm text-certvoice-text
                             focus:outline-none focus:ring-2 focus:ring-certvoice-accent/40 focus:border-certvoice-accent
                             transition-colors"
                >
                  {REGISTRATION_BODIES.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <SettingsField
                label="Registration Number"
                value={settings.registrationNumber}
                onChange={(v) => updateField('registrationNumber', v)}
                placeholder="e.g. NIC/12345"
              />
            </div>
          )}

          {/* ---- SIGNATURE ---- */}
          {activeSection === 'signature' && (
            <div className="cv-card space-y-4">
              <h2 className="text-sm font-bold text-certvoice-text flex items-center gap-2">
                <PenTool className="w-4 h-4 text-certvoice-accent" />
                Digital Signature
              </h2>
              <p className="text-[10px] text-certvoice-muted">
                Draw your signature below. This will appear on every issued certificate in Section G.
              </p>

              <div className="border border-certvoice-border rounded-lg overflow-hidden bg-white">
                <canvas
                  ref={canvasRef}
                  className="w-full touch-none cursor-crosshair"
                  style={{ height: '160px' }}
                  onMouseDown={handleDrawStart}
                  onMouseMove={handleDrawMove}
                  onMouseUp={handleDrawEnd}
                  onMouseLeave={handleDrawEnd}
                  onTouchStart={handleDrawStart}
                  onTouchMove={handleDrawMove}
                  onTouchEnd={handleDrawEnd}
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={clearSignature}
                  disabled={!hasSignature}
                  className="px-3 py-1.5 rounded-lg border border-certvoice-border text-xs font-semibold
                             text-certvoice-muted hover:text-certvoice-red hover:border-certvoice-red/30
                             transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
                {settings.signatureDataUrl && (
                  <button
                    type="button"
                    onClick={() => drawSignatureFromDataUrl(settings.signatureDataUrl ?? '')}
                    className="px-3 py-1.5 rounded-lg border border-certvoice-border text-xs font-semibold
                               text-certvoice-muted hover:text-certvoice-text
                               transition-colors flex items-center gap-1.5"
                  >
                    <Undo2 className="w-3 h-3" />
                    Restore saved
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ---- INSTRUMENTS ---- */}
          {activeSection === 'instruments' && (
            <div className="cv-card space-y-4">
              <h2 className="text-sm font-bold text-certvoice-text flex items-center gap-2">
                <Wrench className="w-4 h-4 text-certvoice-accent" />
                Default Test Instruments
              </h2>
              <p className="text-[10px] text-certvoice-muted">
                Pre-filled on every new certificate schedule. You can override per-certificate.
              </p>

              <InstrumentRow
                label="Multifunction Tester (MFT)"
                serial={settings.mftSerial}
                calibrationDate={settings.mftCalibrationDate}
                onSerialChange={(v) => updateField('mftSerial', v)}
                onCalDateChange={(v) => updateField('mftCalibrationDate', v)}
              />
              <InstrumentRow
                label="Loop Impedance Tester"
                serial={settings.loopTesterSerial}
                calibrationDate={settings.loopTesterCalibrationDate}
                onSerialChange={(v) => updateField('loopTesterSerial', v)}
                onCalDateChange={(v) => updateField('loopTesterCalibrationDate', v)}
              />
              <InstrumentRow
                label="RCD Tester"
                serial={settings.rcdTesterSerial}
                calibrationDate={settings.rcdTesterCalibrationDate}
                onSerialChange={(v) => updateField('rcdTesterSerial', v)}
                onCalDateChange={(v) => updateField('rcdTesterCalibrationDate', v)}
              />
              <InstrumentRow
                label="Insulation Resistance Tester"
                serial={settings.irTesterSerial}
                calibrationDate={settings.irTesterCalibrationDate}
                onSerialChange={(v) => updateField('irTesterSerial', v)}
                onCalDateChange={(v) => updateField('irTesterCalibrationDate', v)}
              />
              <InstrumentRow
                label="Continuity Tester"
                serial={settings.continuityTesterSerial}
                calibrationDate={settings.continuityTesterCalibrationDate}
                onSerialChange={(v) => updateField('continuityTesterSerial', v)}
                onCalDateChange={(v) => updateField('continuityTesterCalibrationDate', v)}
              />

              <div className="bg-certvoice-surface-2 rounded-lg p-3 text-[10px] text-certvoice-muted">
                Calibration dates are checked against the inspection date. CertVoice warns you if any
                instrument was out of calibration during the inspection.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

interface SettingsFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
  type?: 'text' | 'email' | 'tel'
  placeholder?: string
  required?: boolean
  multiline?: boolean
}

function SettingsField({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  placeholder,
  required,
  multiline,
}: SettingsFieldProps) {
  const id = `settings-${label.toLowerCase().replace(/\s+/g, '-')}`
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  const inputClasses = `w-full px-3 py-2 rounded-lg border bg-certvoice-bg text-sm text-certvoice-text
    placeholder-certvoice-muted/40 focus:outline-none focus:ring-2 focus:ring-certvoice-accent/40
    focus:border-certvoice-accent transition-colors ${
      error ? 'border-certvoice-red' : 'border-certvoice-border'
    }`

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-certvoice-muted">
        {label}
        {required && <span className="text-certvoice-red ml-0.5" aria-hidden="true">*</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-[10px] text-certvoice-muted/70">{hint}</p>
      )}
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={inputClasses}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={
            [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
          }
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClasses}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={
            [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
          }
        />
      )}
      {error && (
        <p id={errorId} className="text-xs text-certvoice-red" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

interface InstrumentRowProps {
  label: string
  serial: string
  calibrationDate: string
  onSerialChange: (value: string) => void
  onCalDateChange: (value: string) => void
}

function InstrumentRow({
  label,
  serial,
  calibrationDate,
  onSerialChange,
  onCalDateChange,
}: InstrumentRowProps) {
  const baseId = `instr-${label.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-certvoice-text">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${baseId}-serial`} className="block text-[10px] text-certvoice-muted mb-0.5">
            Serial Number
          </label>
          <input
            id={`${baseId}-serial`}
            type="text"
            value={serial}
            onChange={(e) => onSerialChange(e.target.value)}
            placeholder="e.g. 12345678"
            className="w-full px-3 py-1.5 rounded-lg border border-certvoice-border bg-certvoice-bg
                       text-xs text-certvoice-text placeholder-certvoice-muted/40
                       focus:outline-none focus:ring-2 focus:ring-certvoice-accent/40 focus:border-certvoice-accent
                       transition-colors"
          />
        </div>
        <div>
          <label htmlFor={`${baseId}-cal`} className="block text-[10px] text-certvoice-muted mb-0.5">
            Calibration Date
          </label>
          <input
            id={`${baseId}-cal`}
            type="date"
            value={calibrationDate}
            onChange={(e) => onCalDateChange(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg border border-certvoice-border bg-certvoice-bg
                       text-xs text-certvoice-text
                       focus:outline-none focus:ring-2 focus:ring-certvoice-accent/40 focus:border-certvoice-accent
                       transition-colors"
          />
        </div>
      </div>
    </div>
  )
}
