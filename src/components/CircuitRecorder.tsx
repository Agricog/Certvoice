/**
 * CertVoice — CircuitRecorder Component
 *
 * Two modes:
 *   - 'voice': Record audio → transcribe → AI extract → review grid
 *   - 'manual': Jump straight to review grid for typed entry
 *
 * Confidence UX:
 *   - AI-extracted fields show amber highlight when confidence < 0.7
 *   - "Low confidence — verify this value" hint on amber fields
 *   - Voice transcript stored for evidence trail
 *
 * Props match what InspectionCapture already passes.
 * All form values map to CircuitDetail via mapFormToCircuitDetail().
 *
 * @module components/CircuitRecorder
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Mic, MicOff, ChevronDown, ChevronUp, Check, X, AlertTriangle, Loader2 } from 'lucide-react'
import DOMPurify from 'dompurify'
import type {
  CircuitDetail,
  EarthingType,
  WiringTypeCode,
  ReferenceMethod,
  OCPDType,
  RCDType,
  TickStatus,
} from '../types/eicr'
import { getMaxZs } from '../utils/zsLookup'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CircuitFormData {
  circuit_number: string
  description: string
  type_of_wiring: WiringTypeCode | ''
  reference_method: ReferenceMethod | ''
  number_of_points: string
  ocpd_bs_en: string
  ocpd_type: OCPDType | ''
  ocpd_rating: string
  ocpd_short_circuit_capacity: string
  max_disconnection_time: string
  live_csa: string
  cpc_csa: string
  max_zs: string
  measured_zs: string
  r1_plus_r2: string
  r2: string
  ring_r1: string
  ring_rn: string
  ring_r2: string
  insulation_live_live: string
  insulation_live_earth: string
  polarity_confirmed: TickStatus
  rcd_type: RCDType | ''
  rcd_rated_current: string
  rcd_operating_time: string
  rcd_test_button_ok: TickStatus
  afdd_fitted: TickStatus
  spd_fitted: boolean
  comments: string
}

interface CircuitRecorderProps {
  mode: 'voice' | 'manual'
  locationContext: string
  dbContext: string
  existingCircuits: string[]
  earthingType: EarthingType | null
  editingCircuit?: Partial<CircuitDetail> | null
  onCircuitConfirmed: (data: Partial<CircuitDetail>) => void
  onCancel: () => void
}

type RecorderStep = 'idle' | 'recording' | 'transcribing' | 'extracting' | 'review'

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY_FORM: CircuitFormData = {
  circuit_number: '',
  description: '',
  type_of_wiring: '',
  reference_method: '',
  number_of_points: '',
  ocpd_bs_en: '',
  ocpd_type: '',
  ocpd_rating: '',
  ocpd_short_circuit_capacity: '',
  max_disconnection_time: '',
  live_csa: '',
  cpc_csa: '',
  max_zs: '',
  measured_zs: '',
  r1_plus_r2: '',
  r2: '',
  ring_r1: '',
  ring_rn: '',
  ring_r2: '',
  insulation_live_live: '',
  insulation_live_earth: '',
  polarity_confirmed: 'NA',
  rcd_type: '',
  rcd_rated_current: '',
  rcd_operating_time: '',
  rcd_test_button_ok: 'NA',
  afdd_fitted: 'NA',
  spd_fitted: false,
  comments: '',
}

/** Fields below this confidence score get amber highlighting */
const CONFIDENCE_THRESHOLD = 0.7

/** BS 7671 Appendix 6 Column 3 codes */
const WIRING_TYPES: { code: WiringTypeCode; label: string }[] = [
  { code: 'A', label: 'A — T&E' },
  { code: 'B', label: 'B — PVC/metallic conduit' },
  { code: 'C', label: 'C — PVC/non-metallic conduit' },
  { code: 'D', label: 'D — PVC/metallic trunking' },
  { code: 'E', label: 'E — PVC/non-metallic trunking' },
  { code: 'F', label: 'F — PVC SWA' },
  { code: 'G', label: 'G — XLPE SWA' },
  { code: 'H', label: 'H — MI' },
  { code: 'O', label: 'O — Other' },
]

const REFERENCE_METHODS: ReferenceMethod[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const OCPD_TYPES: OCPDType[] = ['B', 'C', 'D']
const RCD_TYPES: RCDType[] = ['AC', 'A', 'F', 'B', 'S']
const TICK_OPTIONS: { value: TickStatus; label: string }[] = [
  { value: 'TICK', label: '✓' },
  { value: 'CROSS', label: '✗' },
  { value: 'NA', label: 'N/A' },
]
const COMMON_RATINGS = ['6', '10', '16', '20', '25', '32', '40', '45', '50', '63', '80', '100']
const COMMON_CSA = ['1.0', '1.5', '2.5', '4.0', '6.0', '10.0', '16.0', '25.0']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(value: string): string {
  return DOMPurify.sanitize(value.trim(), { ALLOWED_TAGS: [] })
}

function isZsExceeded(measured: string, max: string): boolean {
  const m = parseFloat(measured)
  const x = parseFloat(max)
  if (isNaN(m) || isNaN(x) || x === 0) return false
  return m > x
}

function toNum(val: string): number | null {
  if (!val.trim()) return null
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

/** Convert a numeric value (or null) back to a form string */
function numToStr(val: number | string | null | undefined): string {
  if (val == null) return ''
  return String(val)
}

function mapFormToCircuitDetail(f: CircuitFormData): Partial<CircuitDetail> {
  return {
    circuitNumber: f.circuit_number,
    circuitDescription: f.description,
    wiringType: f.type_of_wiring || null,
    referenceMethod: f.reference_method || null,
    numberOfPoints: toNum(f.number_of_points),
    ocpdBsEn: f.ocpd_bs_en,
    ocpdType: f.ocpd_type || null,
    ocpdRating: toNum(f.ocpd_rating),
    breakingCapacity: toNum(f.ocpd_short_circuit_capacity),
    maxDisconnectTime: toNum(f.max_disconnection_time),
    liveConductorCsa: toNum(f.live_csa),
    cpcCsa: toNum(f.cpc_csa),
    maxPermittedZs: toNum(f.max_zs),
    zs: toNum(f.measured_zs),
    r1r2: toNum(f.r1_plus_r2),
    r2Standalone: toNum(f.r2),
    r1: toNum(f.ring_r1),
    rn: toNum(f.ring_rn),
    r2: toNum(f.ring_r2),
    irLiveLive: toNum(f.insulation_live_live),
    irLiveEarth: toNum(f.insulation_live_earth),
    polarity: f.polarity_confirmed,
    rcdType: f.rcd_type || null,
    rcdRating: toNum(f.rcd_rated_current),
    rcdDisconnectionTime: toNum(f.rcd_operating_time),
    rcdTestButton: f.rcd_test_button_ok,
    afddTestButton: f.afdd_fitted,
    remarks: f.comments,
  }
}

/** Reverse map: CircuitDetail → form data for pre-populating edit mode */
function mapCircuitDetailToForm(c: Partial<CircuitDetail>): CircuitFormData {
  return {
    circuit_number: c.circuitNumber ?? '',
    description: c.circuitDescription ?? '',
    type_of_wiring: c.wiringType ?? '',
    reference_method: c.referenceMethod ?? '',
    number_of_points: numToStr(c.numberOfPoints),
    ocpd_bs_en: c.ocpdBsEn ?? '',
    ocpd_type: c.ocpdType ?? '',
    ocpd_rating: numToStr(c.ocpdRating),
    ocpd_short_circuit_capacity: numToStr(c.breakingCapacity),
    max_disconnection_time: numToStr(c.maxDisconnectTime),
    live_csa: numToStr(c.liveConductorCsa),
    cpc_csa: numToStr(c.cpcCsa),
    max_zs: numToStr(c.maxPermittedZs),
    measured_zs: numToStr(c.zs),
    r1_plus_r2: numToStr(c.r1r2),
    r2: numToStr(c.r2Standalone),
    ring_r1: numToStr(c.r1),
    ring_rn: numToStr(c.rn),
    ring_r2: numToStr(c.r2),
    insulation_live_live: numToStr(c.irLiveLive),
    insulation_live_earth: numToStr(c.irLiveEarth),
    polarity_confirmed: c.polarity ?? 'NA',
    rcd_type: c.rcdType ?? '',
    rcd_rated_current: numToStr(c.rcdRating),
    rcd_operating_time: numToStr(c.rcdDisconnectionTime),
    rcd_test_button_ok: c.rcdTestButton ?? 'NA',
    afdd_fitted: c.afddTestButton ?? 'NA',
    spd_fitted: false,
    comments: c.remarks ?? '',
  }
}

// ─── Section Component ────────────────────────────────────────────────────────

function FormSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden mb-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800 text-white text-sm font-semibold"
      >
        {title}
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && <div className="p-4 space-y-3 bg-slate-900">{children}</div>}
    </div>
  )
}

// ─── Field Components ─────────────────────────────────────────────────────────

function TextField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  warning,
  inputMode,
  lowConfidence,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  suffix?: string
  warning?: string
  inputMode?: 'text' | 'numeric' | 'decimal'
  lowConfidence?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <div className="relative">
        <input
          type="text"
          inputMode={inputMode || 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-slate-800 border rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            warning
              ? 'border-amber-500'
              : lowConfidence
              ? 'border-amber-500/50 bg-amber-950/20'
              : 'border-slate-600'
          } ${suffix ? 'pr-10' : ''}`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
            {suffix}
          </span>
        )}
      </div>
      {warning && (
        <div className="flex items-center gap-1 mt-1 text-xs text-amber-400">
          <AlertTriangle size={12} />
          {warning}
        </div>
      )}
      {!warning && lowConfidence && (
        <div className="flex items-center gap-1 mt-1 text-xs text-amber-400/70">
          <AlertTriangle size={10} />
          Low confidence — verify this value
        </div>
      )}
    </div>
  )
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  placeholder,
  lowConfidence,
}: {
  label: string
  value: T | ''
  onChange: (v: T | '') => void
  options: { value: T; label: string }[]
  placeholder?: string
  lowConfidence?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T | '')}
        className={`w-full bg-slate-800 border rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          lowConfidence ? 'border-amber-500/50 bg-amber-950/20' : 'border-slate-600'
        }`}
      >
        <option value="">{placeholder || 'Select...'}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {lowConfidence && (
        <div className="flex items-center gap-1 mt-1 text-xs text-amber-400/70">
          <AlertTriangle size={10} />
          Low confidence — verify this value
        </div>
      )}
    </div>
  )
}

function TickField({
  label,
  value,
  onChange,
}: {
  label: string
  value: TickStatus
  onChange: (v: TickStatus) => void
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <div className="flex gap-1">
        {TICK_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-2 rounded-md text-sm font-semibold border transition-colors ${
              value === opt.value
                ? opt.value === 'TICK'
                  ? 'bg-green-900/40 border-green-600 text-green-300'
                  : opt.value === 'CROSS'
                  ? 'bg-red-900/40 border-red-600 text-red-300'
                  : 'bg-slate-700 border-slate-500 text-slate-300'
                : 'bg-slate-800 border-slate-600 text-slate-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors ${
        value
          ? 'bg-green-900/40 border-green-600 text-green-300'
          : 'bg-slate-800 border-slate-600 text-slate-400'
      }`}
    >
      <div
        className={`w-4 h-4 rounded flex items-center justify-center ${
          value ? 'bg-green-600' : 'bg-slate-700'
        }`}
      >
        {value && <Check size={12} className="text-white" />}
      </div>
      {label}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CircuitRecorder({
  mode,
  locationContext: _locationContext,
  dbContext,
  existingCircuits: _existingCircuits,
  earthingType: _earthingType,
  editingCircuit,
  onCircuitConfirmed,
  onCancel,
}: CircuitRecorderProps) {
  const { getToken } = useAuth()
  const [step, setStep] = useState<RecorderStep>(mode === 'manual' ? 'review' : 'idle')
  const [formData, setFormData] = useState<CircuitFormData>(() => {
    if (editingCircuit) return mapCircuitDetailToForm(editingCircuit)
    return { ...EMPTY_FORM }
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const maxZsManualRef = useRef(!!editingCircuit?.maxPermittedZs) // don't auto-overwrite when editing

  // Voice transcript + AI confidence state
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(
    editingCircuit?.voiceTranscript ?? null
  )
  const [fieldConfidence, setFieldConfidence] = useState<Record<string, number> | null>(
    editingCircuit?.fieldConfidence ?? null
  )

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)

  /** Check if a field has low AI confidence (below threshold) */
  const isLowConfidence = useCallback(
    (fieldKey: string): boolean => {
      if (!fieldConfidence) return false
      const score = fieldConfidence[fieldKey]
      return score !== undefined && score < CONFIDENCE_THRESHOLD
    },
    [fieldConfidence]
  )

  // ── Voice recording ───────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Audio level visualisation
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        setAudioLevel(avg / 255)
        animFrameRef.current = requestAnimationFrame(updateLevel)
      }
      updateLevel()

      // MediaRecorder — use webm where supported, fall back to mp4 for Safari
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4'

      const recorder = new MediaRecorder(stream, { mimeType })
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
        setAudioLevel(0)

        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        await transcribeAudio(blob)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
      setStep('recording')
    } catch {
      setError('Microphone access denied. Check browser permissions.')
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setStep('transcribing')
    }
  }, [])

  const transcribeAudio = async (blob: Blob) => {
    try {
      const token = await getToken()
      const apiBase = import.meta.env.VITE_API_BASE_URL

      const res = await fetch(`${apiBase}/api/speech/transcribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': blob.type,
        },
        body: blob,
      })

      if (!res.ok) throw new Error(`Transcription failed (${res.status})`)

      const data = await res.json()
      if (!data.success || !data.transcript) {
        throw new Error('No transcript returned')
      }

      setStep('extracting')
      await extractCircuitData(data.transcript)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed')
      setStep('idle')
    }
  }

  const extractCircuitData = async (transcript: string) => {
    try {
      const token = await getToken()
      const apiBase = import.meta.env.VITE_API_BASE_URL

      const res = await fetch(`${apiBase}/api/extract`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript, dbContext, type: 'circuit' }),
      })

      if (!res.ok) throw new Error(`Extraction failed (${res.status})`)

      const data = await res.json()
      if (data.success && data.circuit) {
        const c = data.circuit
        setFormData((prev) => ({
          ...prev,
          circuit_number: c.circuitNumber ?? prev.circuit_number,
          description: c.circuitDescription ?? prev.description,
          type_of_wiring: c.wiringType ?? prev.type_of_wiring,
          reference_method: c.referenceMethod ?? prev.reference_method,
          number_of_points: c.numberOfPoints != null ? String(c.numberOfPoints) : prev.number_of_points,
          ocpd_bs_en: c.ocpdBsEn ?? prev.ocpd_bs_en,
          ocpd_type: c.ocpdType ?? prev.ocpd_type,
          ocpd_rating: c.ocpdRating != null ? String(c.ocpdRating) : prev.ocpd_rating,
          live_csa: c.liveConductorCsa != null ? String(c.liveConductorCsa) : prev.live_csa,
          cpc_csa: c.cpcCsa != null ? String(c.cpcCsa) : prev.cpc_csa,
          measured_zs: c.zs != null ? String(c.zs) : prev.measured_zs,
          r1_plus_r2: c.r1r2 != null ? String(c.r1r2) : prev.r1_plus_r2,
          r2: c.r2 != null ? String(c.r2) : prev.r2,
          ring_r1: c.r1 != null ? String(c.r1) : prev.ring_r1,
          ring_rn: c.rn != null ? String(c.rn) : prev.ring_rn,
          ring_r2: c.r2 != null ? String(c.r2) : prev.ring_r2,
          insulation_live_live: c.irLiveLive != null ? String(c.irLiveLive) : prev.insulation_live_live,
          insulation_live_earth: c.irLiveEarth != null ? String(c.irLiveEarth) : prev.insulation_live_earth,
          polarity_confirmed: c.polarity ?? prev.polarity_confirmed,
          rcd_type: c.rcdType ?? prev.rcd_type,
          rcd_rated_current: c.rcdRating != null ? String(c.rcdRating) : prev.rcd_rated_current,
          rcd_operating_time: c.rcdDisconnectionTime != null ? String(c.rcdDisconnectionTime) : prev.rcd_operating_time,
          comments: c.remarks ?? prev.comments,
        }))
        if (data.fieldConfidence) setFieldConfidence(data.fieldConfidence)
      }

      // Store transcript for evidence trail
      setVoiceTranscript(transcript)
      setStep('review')
    } catch {
      // If extraction fails, still show review grid with transcript in comments
      setFormData((prev) => ({
        ...prev,
        comments: `[Voice transcript] ${transcript}`,
      }))
      setVoiceTranscript(transcript)
      setStep('review')
    }
  }

  // ── Form handlers ─────────────────────────────────────────────────────────

  const updateField = useCallback(
    <K extends keyof CircuitFormData>(key: K, value: CircuitFormData[K]) => {
      setFormData((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const handleConfirm = async () => {
    // Sanitize all string fields before submission
    const sanitized: CircuitFormData = { ...formData }
    for (const key of Object.keys(sanitized) as (keyof CircuitFormData)[]) {
      const val = sanitized[key]
      if (typeof val === 'string') {
        ;(sanitized[key] as string) = sanitize(val)
      }
    }

    // Basic validation — circuit number is required
    if (!sanitized.circuit_number.trim()) {
      setError('Circuit number is required')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const mapped = mapFormToCircuitDetail(sanitized)
      onCircuitConfirmed({
        ...mapped,
        // Preserve the original id when editing so the parent merges rather than appends
        ...(editingCircuit?.id ? { id: editingCircuit.id } : {}),
        voiceTranscript: voiceTranscript ?? undefined,
        fieldConfidence: fieldConfidence ?? undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save circuit')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Zs warning ────────────────────────────────────────────────────────────

  const zsWarning = isZsExceeded(formData.measured_zs, formData.max_zs)
    ? `Measured Zs (${formData.measured_zs}Ω) exceeds max permitted (${formData.max_zs}Ω)`
    : undefined

  // ── Auto-fill max Zs from BS 7671 lookup ──────────────────────────────────

  useEffect(() => {
    // Don't overwrite if user manually edited the field or editing existing circuit
    if (maxZsManualRef.current) return

    const rating = parseFloat(formData.ocpd_rating)
    const disconnectTime = parseFloat(formData.max_disconnection_time) || null
    const calculated = getMaxZs(formData.ocpd_type, isNaN(rating) ? null : rating, disconnectTime)

    if (calculated !== null) {
      setFormData((prev) => ({ ...prev, max_zs: calculated.toFixed(2) }))
    }
  }, [formData.ocpd_type, formData.ocpd_rating, formData.max_disconnection_time])

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  // ── Render: Voice capture steps ───────────────────────────────────────────

  if (step === 'idle' || step === 'recording') {
    return (
      <div className="fixed inset-0 bg-slate-950/95 z-50 flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <h2 className="text-white text-lg font-semibold mb-2">Record Circuit Details</h2>
          <p className="text-slate-400 text-sm mb-8">
            Describe the circuit — number, description, cable type, protective device, test results.
          </p>

          {/* Mic button with audio level ring */}
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            className="relative mx-auto mb-6 block"
          >
            <div
              className={`w-24 h-24 rounded-full flex items-center justify-center transition-colors ${
                isRecording ? 'bg-red-600' : 'bg-blue-600 hover:bg-blue-500'
              }`}
              style={
                isRecording
                  ? {
                      boxShadow: `0 0 0 ${4 + audioLevel * 20}px rgba(239,68,68,${
                        0.15 + audioLevel * 0.3
                      })`,
                    }
                  : undefined
              }
            >
              {isRecording ? (
                <MicOff size={32} className="text-white" />
              ) : (
                <Mic size={32} className="text-white" />
              )}
            </div>
          </button>

          <p className="text-slate-500 text-xs">
            {isRecording ? 'Tap to stop recording' : 'Tap to start recording'}
          </p>

          {error && (
            <div className="mt-4 p-3 bg-red-900/40 border border-red-700 rounded-md text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="mt-8 text-slate-500 text-sm hover:text-slate-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (step === 'transcribing' || step === 'extracting') {
    return (
      <div className="fixed inset-0 bg-slate-950/95 z-50 flex flex-col items-center justify-center p-6">
        <Loader2 size={40} className="text-blue-500 animate-spin mb-4" />
        <p className="text-white text-sm">
          {step === 'transcribing' ? 'Transcribing audio...' : 'Extracting circuit data...'}
        </p>
      </div>
    )
  }

  // ── Render: Review grid (shared by voice + manual) ────────────────────────

  return (
    <div className="fixed inset-0 bg-slate-950 z-50 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 text-slate-400 hover:text-white text-sm transition-colors"
        >
          <X size={18} />
          Cancel
        </button>
        <h2 className="text-white text-sm font-semibold">
          {editingCircuit ? 'Edit Circuit' : mode === 'manual' ? 'Manual Entry' : 'Review Circuit'}
        </h2>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
        >
          {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Confirm
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-900/40 border border-red-700 rounded-md text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Zs exceeded warning banner */}
      {zsWarning && (
        <div className="mx-4 mt-3 p-3 bg-amber-900/40 border border-amber-600 rounded-md text-amber-300 text-sm flex items-center gap-2">
          <AlertTriangle size={16} />
          {zsWarning}
        </div>
      )}

      {/* Confidence banner — shows when voice-extracted with low overall confidence */}
      {voiceTranscript && fieldConfidence && Object.values(fieldConfidence).some((v) => v < CONFIDENCE_THRESHOLD) && (
        <div className="mx-4 mt-3 p-3 bg-amber-900/20 border border-amber-600/40 rounded-md text-amber-300/80 text-xs flex items-center gap-2">
          <AlertTriangle size={14} />
          Some fields have low AI confidence (amber highlighted). Please verify before confirming.
        </div>
      )}

      {/* Form sections */}
      <div className="p-4 pb-24">
        {/* ── Circuit Identity ────────────────────────────────────────────── */}
        <FormSection title="Circuit Identity" defaultOpen={true}>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Circuit No."
              value={formData.circuit_number}
              onChange={(v) => updateField('circuit_number', v)}
              placeholder="e.g. 1"
              lowConfidence={isLowConfidence('circuit_number')}
            />
            <TextField
              label="No. of Points"
              value={formData.number_of_points}
              onChange={(v) => updateField('number_of_points', v)}
              inputMode="numeric"
              lowConfidence={isLowConfidence('number_of_points')}
            />
          </div>
          <TextField
            label="Description"
            value={formData.description}
            onChange={(v) => updateField('description', v)}
            placeholder="e.g. Ring final — ground floor sockets"
            lowConfidence={isLowConfidence('description')}
          />
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Wiring Type"
              value={formData.type_of_wiring}
              onChange={(v) => updateField('type_of_wiring', v as WiringTypeCode | '')}
              options={WIRING_TYPES.map((w) => ({ value: w.code, label: w.label }))}
              lowConfidence={isLowConfidence('type_of_wiring')}
            />
            <SelectField
              label="Ref. Method"
              value={formData.reference_method}
              onChange={(v) => updateField('reference_method', v as ReferenceMethod | '')}
              options={REFERENCE_METHODS.map((m) => ({ value: m, label: m }))}
              lowConfidence={isLowConfidence('reference_method')}
            />
          </div>
        </FormSection>

        {/* ── Protective Device ───────────────────────────────────────────── */}
        <FormSection title="Overcurrent Protective Device" defaultOpen={true}>
          <TextField
            label="BS(EN)"
            value={formData.ocpd_bs_en}
            onChange={(v) => updateField('ocpd_bs_en', v)}
            placeholder="e.g. 60898"
            lowConfidence={isLowConfidence('ocpd_bs_en')}
          />
          <div className="grid grid-cols-3 gap-3">
            <SelectField
              label="Type"
              value={formData.ocpd_type}
              onChange={(v) => updateField('ocpd_type', v as OCPDType | '')}
              options={OCPD_TYPES.map((t) => ({ value: t, label: t }))}
              lowConfidence={isLowConfidence('ocpd_type')}
            />
            <SelectField
              label="Rating"
              value={formData.ocpd_rating}
              onChange={(v) => updateField('ocpd_rating', v)}
              options={COMMON_RATINGS.map((r) => ({ value: r, label: `${r}A` }))}
              placeholder="A"
              lowConfidence={isLowConfidence('ocpd_rating')}
            />
            <TextField
              label="kA"
              value={formData.ocpd_short_circuit_capacity}
              onChange={(v) => updateField('ocpd_short_circuit_capacity', v)}
              inputMode="decimal"
              suffix="kA"
              lowConfidence={isLowConfidence('ocpd_short_circuit_capacity')}
            />
          </div>
          <TextField
            label="Max Disconnection Time"
            value={formData.max_disconnection_time}
            onChange={(v) => updateField('max_disconnection_time', v)}
            inputMode="decimal"
            suffix="s"
            lowConfidence={isLowConfidence('max_disconnection_time')}
          />
        </FormSection>

        {/* ── Cable ───────────────────────────────────────────────────────── */}
        <FormSection title="Cable" defaultOpen={true}>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Live CSA"
              value={formData.live_csa}
              onChange={(v) => updateField('live_csa', v)}
              options={COMMON_CSA.map((c) => ({ value: c, label: `${c} mm²` }))}
              placeholder="mm²"
              lowConfidence={isLowConfidence('live_csa')}
            />
            <SelectField
              label="CPC CSA"
              value={formData.cpc_csa}
              onChange={(v) => updateField('cpc_csa', v)}
              options={COMMON_CSA.map((c) => ({ value: c, label: `${c} mm²` }))}
              placeholder="mm²"
              lowConfidence={isLowConfidence('cpc_csa')}
            />
          </div>
        </FormSection>

        {/* ── Test Results ────────────────────────────────────────────────── */}
        <FormSection title="Test Results" defaultOpen={true}>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Max Zs"
              value={formData.max_zs}
              onChange={(v) => {
                maxZsManualRef.current = true
                updateField('max_zs', v)
              }}
              inputMode="decimal"
              suffix="Ω"
              placeholder={formData.ocpd_type && formData.ocpd_rating ? 'Auto' : ''}
              lowConfidence={isLowConfidence('max_zs')}
            />
            <TextField
              label="Measured Zs"
              value={formData.measured_zs}
              onChange={(v) => updateField('measured_zs', v)}
              inputMode="decimal"
              suffix="Ω"
              warning={zsWarning}
              lowConfidence={isLowConfidence('measured_zs')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="R1+R2"
              value={formData.r1_plus_r2}
              onChange={(v) => updateField('r1_plus_r2', v)}
              inputMode="decimal"
              suffix="Ω"
              lowConfidence={isLowConfidence('r1_plus_r2')}
            />
            <TextField
              label="R2"
              value={formData.r2}
              onChange={(v) => updateField('r2', v)}
              inputMode="decimal"
              suffix="Ω"
              lowConfidence={isLowConfidence('r2')}
            />
          </div>

          {/* Ring final continuity */}
          <p className="text-xs text-slate-500 mt-2 mb-1">Ring Final Continuity</p>
          <div className="grid grid-cols-3 gap-3">
            <TextField
              label="r1"
              value={formData.ring_r1}
              onChange={(v) => updateField('ring_r1', v)}
              inputMode="decimal"
              suffix="Ω"
              lowConfidence={isLowConfidence('ring_r1')}
            />
            <TextField
              label="rn"
              value={formData.ring_rn}
              onChange={(v) => updateField('ring_rn', v)}
              inputMode="decimal"
              suffix="Ω"
              lowConfidence={isLowConfidence('ring_rn')}
            />
            <TextField
              label="r2"
              value={formData.ring_r2}
              onChange={(v) => updateField('ring_r2', v)}
              inputMode="decimal"
              suffix="Ω"
              lowConfidence={isLowConfidence('ring_r2')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 mt-2">
            <TextField
              label="IR Live/Live"
              value={formData.insulation_live_live}
              onChange={(v) => updateField('insulation_live_live', v)}
              inputMode="decimal"
              suffix="MΩ"
              lowConfidence={isLowConfidence('insulation_live_live')}
            />
            <TextField
              label="IR Live/Earth"
              value={formData.insulation_live_earth}
              onChange={(v) => updateField('insulation_live_earth', v)}
              inputMode="decimal"
              suffix="MΩ"
              lowConfidence={isLowConfidence('insulation_live_earth')}
            />
          </div>

          <div className="mt-2">
            <TickField
              label="Polarity confirmed"
              value={formData.polarity_confirmed}
              onChange={(v) => updateField('polarity_confirmed', v)}
            />
          </div>
        </FormSection>

        {/* ── RCD ─────────────────────────────────────────────────────────── */}
        <FormSection title="RCD" defaultOpen={false}>
          <SelectField
            label="RCD Type"
            value={formData.rcd_type}
            onChange={(v) => updateField('rcd_type', v as RCDType | '')}
            options={RCD_TYPES.map((t) => ({ value: t, label: t }))}
            lowConfidence={isLowConfidence('rcd_type')}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Rated IΔn"
              value={formData.rcd_rated_current}
              onChange={(v) => updateField('rcd_rated_current', v)}
              inputMode="numeric"
              suffix="mA"
              lowConfidence={isLowConfidence('rcd_rated_current')}
            />
            <TextField
              label="Operating Time"
              value={formData.rcd_operating_time}
              onChange={(v) => updateField('rcd_operating_time', v)}
              inputMode="numeric"
              suffix="ms"
              lowConfidence={isLowConfidence('rcd_operating_time')}
            />
          </div>
          <TickField
            label="Test button operates correctly"
            value={formData.rcd_test_button_ok}
            onChange={(v) => updateField('rcd_test_button_ok', v)}
          />
        </FormSection>

        {/* ── Additional ──────────────────────────────────────────────────── */}
        <FormSection title="Additional" defaultOpen={false}>
          <div className="flex gap-3 flex-wrap">
            <TickField
              label="AFDD test button"
              value={formData.afdd_fitted}
              onChange={(v) => updateField('afdd_fitted', v)}
            />
            <ToggleField
              label="SPD fitted"
              value={formData.spd_fitted}
              onChange={(v) => updateField('spd_fitted', v)}
            />
          </div>
          <div className="mt-2">
            <label className="block text-xs text-slate-400 mb-1">Comments</label>
            <textarea
              value={formData.comments}
              onChange={(e) => updateField('comments', e.target.value)}
              rows={3}
              className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Any additional notes..."
            />
          </div>
        </FormSection>

        {/* ── Voice Transcript (evidence trail — only shown for voice mode) ── */}
        {voiceTranscript && (
          <FormSection title="Voice Transcript" defaultOpen={false}>
            <div className="bg-slate-800/50 rounded-md p-3 border border-slate-700">
              <p className="text-xs text-slate-400 font-mono leading-relaxed whitespace-pre-wrap">
                {voiceTranscript}
              </p>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Original voice recording transcript — stored for audit trail
            </p>
          </FormSection>
        )}
      </div>
    </div>
  )
}
