import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Mic, MicOff, ChevronDown, ChevronUp, Check, X, AlertTriangle, Loader2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { CircuitDetail } from '../types/eicr';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CircuitFormData {
  circuit_number: string;
  description: string;
  type_of_wiring: string;
  reference_method: string;
  number_of_points: string;
  ocpd_bs_en: string;
  ocpd_type: string;
  ocpd_rating: string;
  ocpd_short_circuit_capacity: string;
  max_disconnection_time: string;
  live_csa: string;
  cpc_csa: string;
  max_zs: string;
  measured_zs: string;
  r1_plus_r2: string;
  r2: string;
  ring_r1: string;
  ring_rn: string;
  ring_r2: string;
  insulation_live_live: string;
  insulation_live_earth: string;
  polarity_confirmed: boolean;
  rcd_type: string;
  rcd_rated_current: string;
  rcd_operating_time: string;
  rcd_test_button_ok: boolean;
  afdd_fitted: boolean;
  spd_fitted: boolean;
  comments: string;
}

interface CircuitRecorderProps {
  mode: 'voice' | 'manual';
  locationContext: string;
  dbContext: string;
  existingCircuits: string[];
  earthingType: string | null;
  onCircuitConfirmed: (data: Partial<CircuitDetail>) => void;
  onCancel: () => void;
}

type RecorderStep = 'idle' | 'recording' | 'transcribing' | 'extracting' | 'review';

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
  polarity_confirmed: false,
  rcd_type: '',
  rcd_rated_current: '',
  rcd_operating_time: '',
  rcd_test_button_ok: false,
  afdd_fitted: false,
  spd_fitted: false,
  comments: '',
};

const WIRING_TYPES = ['T+E', 'SWA', 'MICC', 'FP200', 'Flex', 'Conduit/SCC', 'Trunking/SCC', 'Other'];
const REFERENCE_METHODS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const OCPD_TYPES = ['B', 'C', 'D', '1', '2', '3', '4'];
const RCD_TYPES = ['AC', 'A', 'F', 'B', 'S', 'None'];
const COMMON_RATINGS = ['6', '10', '16', '20', '25', '32', '40', '45', '50', '63', '80', '100'];
const COMMON_CSA = ['1.0', '1.5', '2.5', '4.0', '6.0', '10.0', '16.0', '25.0'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(value: string): string {
  return DOMPurify.sanitize(value.trim(), { ALLOWED_TAGS: [] });
}

function isZsExceeded(measured: string, max: string): boolean {
  const m = parseFloat(measured);
  const x = parseFloat(max);
  if (isNaN(m) || isNaN(x) || x === 0) return false;
  return m > x;
}

function toNum(val: string): number | null {
  if (!val.trim()) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
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
    polarity: f.polarity_confirmed ? 'CONFIRMED' : 'NA',
    rcdType: f.rcd_type || null,
    rcdRating: toNum(f.rcd_rated_current),
    rcdDisconnectionTime: toNum(f.rcd_operating_time),
    rcdTestButton: f.rcd_test_button_ok ? 'PASS' : 'NA',
    afddTestButton: f.afdd_fitted ? 'PASS' : 'NA',
    remarks: f.comments,
  };
}

// ─── Section Component ────────────────────────────────────────────────────────

function FormSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

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
  );
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  warning?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
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
            warning ? 'border-amber-500' : 'border-slate-600'
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
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">{placeholder || 'Select...'}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
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
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CircuitRecorder({
  mode,
  locationContext,
  dbContext,
  existingCircuits,
  earthingType,
  onCircuitConfirmed,
  onCancel,
}: CircuitRecorderProps) {
  const { getToken } = useAuth();
  const [step, setStep] = useState<RecorderStep>(mode === 'manual' ? 'review' : 'idle');
  const [formData, setFormData] = useState<CircuitFormData>(() => ({
    ...EMPTY_FORM,
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // ── Voice recording ───────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Audio level visualisation
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(avg / 255);
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // MediaRecorder — use webm where supported, fall back to mp4 for Safari
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        setAudioLevel(0);

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        await transcribeAudio(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setStep('recording');
    } catch (err) {
      setError('Microphone access denied. Check browser permissions.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStep('transcribing');
    }
  }, []);

  const transcribeAudio = async (blob: Blob) => {
    try {
      const token = await getToken();
      const apiBase = import.meta.env.VITE_API_BASE_URL;

      const res = await fetch(`${apiBase}/api/speech/transcribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': blob.type,
        },
        body: blob,
      });

      if (!res.ok) throw new Error(`Transcription failed (${res.status})`);

      const data = await res.json();
      if (!data.success || !data.transcript) {
        throw new Error('No transcript returned');
      }

      setStep('extracting');
      await extractCircuitData(data.transcript);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed');
      setStep('idle');
    }
  };

  const extractCircuitData = async (transcript: string) => {
    try {
      const token = await getToken();
      const apiBase = import.meta.env.VITE_API_BASE_URL;

      // Call AI extraction endpoint (assumes a worker at /api/extract/circuit)
      const res = await fetch(`${apiBase}/api/extract/circuit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript, dbContext }),
      });

      if (!res.ok) throw new Error(`Extraction failed (${res.status})`);

      const data = await res.json();
      if (data.success && data.circuit) {
        setFormData((prev) => ({ ...prev, ...data.circuit }));
      }

      setStep('review');
    } catch (err) {
      // If extraction fails, still show review grid with transcript in comments
      setFormData((prev) => ({
        ...prev,
        comments: `[Voice transcript] ${transcript}`,
      }));
      setStep('review');
    }
  };

  // ── Form handlers ─────────────────────────────────────────────────────────

  const updateField = useCallback(
    <K extends keyof CircuitFormData>(key: K, value: CircuitFormData[K]) => {
      setFormData((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleConfirm = async () => {
    // Sanitize all string fields before submission
    const sanitized: CircuitFormData = { ...formData };
    for (const key of Object.keys(sanitized) as (keyof CircuitFormData)[]) {
      const val = sanitized[key];
      if (typeof val === 'string') {
        (sanitized[key] as string) = sanitize(val);
      }
    }

    // Basic validation — circuit number is required
    if (!sanitized.circuit_number.trim()) {
      setError('Circuit number is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const mapped = mapFormToCircuitDetail(sanitized);
      onCircuitConfirmed(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save circuit');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Zs warning ────────────────────────────────────────────────────────────

  const zsWarning = isZsExceeded(formData.measured_zs, formData.max_zs)
    ? `Measured Zs (${formData.measured_zs}Ω) exceeds max permitted (${formData.max_zs}Ω)`
    : undefined;

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

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
                  ? { boxShadow: `0 0 0 ${4 + audioLevel * 20}px rgba(239,68,68,${0.15 + audioLevel * 0.3})` }
                  : undefined
              }
            >
              {isRecording ? <MicOff size={32} className="text-white" /> : <Mic size={32} className="text-white" />}
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
    );
  }

  if (step === 'transcribing' || step === 'extracting') {
    return (
      <div className="fixed inset-0 bg-slate-950/95 z-50 flex flex-col items-center justify-center p-6">
        <Loader2 size={40} className="text-blue-500 animate-spin mb-4" />
        <p className="text-white text-sm">
          {step === 'transcribing' ? 'Transcribing audio...' : 'Extracting circuit data...'}
        </p>
      </div>
    );
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
          {mode === 'manual' ? 'Manual Entry' : 'Review Circuit'}
        </h2>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
        >
          {isSubmitting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
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
            />
            <TextField
              label="No. of Points"
              value={formData.number_of_points}
              onChange={(v) => updateField('number_of_points', v)}
              inputMode="numeric"
            />
          </div>
          <TextField
            label="Description"
            value={formData.description}
            onChange={(v) => updateField('description', v)}
            placeholder="e.g. Ring final — ground floor sockets"
          />
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Wiring Type"
              value={formData.type_of_wiring}
              onChange={(v) => updateField('type_of_wiring', v)}
              options={WIRING_TYPES}
            />
            <SelectField
              label="Ref. Method"
              value={formData.reference_method}
              onChange={(v) => updateField('reference_method', v)}
              options={REFERENCE_METHODS}
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
          />
          <div className="grid grid-cols-3 gap-3">
            <SelectField
              label="Type"
              value={formData.ocpd_type}
              onChange={(v) => updateField('ocpd_type', v)}
              options={OCPD_TYPES}
            />
            <SelectField
              label="Rating"
              value={formData.ocpd_rating}
              onChange={(v) => updateField('ocpd_rating', v)}
              options={COMMON_RATINGS}
              placeholder="A"
            />
            <TextField
              label="kA"
              value={formData.ocpd_short_circuit_capacity}
              onChange={(v) => updateField('ocpd_short_circuit_capacity', v)}
              inputMode="decimal"
              suffix="kA"
            />
          </div>
          <TextField
            label="Max Disconnection Time"
            value={formData.max_disconnection_time}
            onChange={(v) => updateField('max_disconnection_time', v)}
            inputMode="decimal"
            suffix="s"
          />
        </FormSection>

        {/* ── Cable ───────────────────────────────────────────────────────── */}
        <FormSection title="Cable" defaultOpen={true}>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Live CSA"
              value={formData.live_csa}
              onChange={(v) => updateField('live_csa', v)}
              options={COMMON_CSA}
              placeholder="mm²"
            />
            <SelectField
              label="CPC CSA"
              value={formData.cpc_csa}
              onChange={(v) => updateField('cpc_csa', v)}
              options={COMMON_CSA}
              placeholder="mm²"
            />
          </div>
        </FormSection>

        {/* ── Test Results ────────────────────────────────────────────────── */}
        <FormSection title="Test Results" defaultOpen={true}>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Max Zs"
              value={formData.max_zs}
              onChange={(v) => updateField('max_zs', v)}
              inputMode="decimal"
              suffix="Ω"
            />
            <TextField
              label="Measured Zs"
              value={formData.measured_zs}
              onChange={(v) => updateField('measured_zs', v)}
              inputMode="decimal"
              suffix="Ω"
              warning={zsWarning}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="R1+R2"
              value={formData.r1_plus_r2}
              onChange={(v) => updateField('r1_plus_r2', v)}
              inputMode="decimal"
              suffix="Ω"
            />
            <TextField
              label="R2"
              value={formData.r2}
              onChange={(v) => updateField('r2', v)}
              inputMode="decimal"
              suffix="Ω"
            />
          </div>

          {/* Ring final continuity — only show if description suggests ring */}
          <p className="text-xs text-slate-500 mt-2 mb-1">Ring Final Continuity</p>
          <div className="grid grid-cols-3 gap-3">
            <TextField
              label="r1"
              value={formData.ring_r1}
              onChange={(v) => updateField('ring_r1', v)}
              inputMode="decimal"
              suffix="Ω"
            />
            <TextField
              label="rn"
              value={formData.ring_rn}
              onChange={(v) => updateField('ring_rn', v)}
              inputMode="decimal"
              suffix="Ω"
            />
            <TextField
              label="r2"
              value={formData.ring_r2}
              onChange={(v) => updateField('ring_r2', v)}
              inputMode="decimal"
              suffix="Ω"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 mt-2">
            <TextField
              label="IR Live/Live"
              value={formData.insulation_live_live}
              onChange={(v) => updateField('insulation_live_live', v)}
              inputMode="decimal"
              suffix="MΩ"
            />
            <TextField
              label="IR Live/Earth"
              value={formData.insulation_live_earth}
              onChange={(v) => updateField('insulation_live_earth', v)}
              inputMode="decimal"
              suffix="MΩ"
            />
          </div>

          <div className="mt-2">
            <ToggleField
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
            onChange={(v) => updateField('rcd_type', v)}
            options={RCD_TYPES}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Rated IΔn"
              value={formData.rcd_rated_current}
              onChange={(v) => updateField('rcd_rated_current', v)}
              inputMode="numeric"
              suffix="mA"
            />
            <TextField
              label="Operating Time"
              value={formData.rcd_operating_time}
              onChange={(v) => updateField('rcd_operating_time', v)}
              inputMode="numeric"
              suffix="ms"
            />
          </div>
          <ToggleField
            label="Test button operates correctly"
            value={formData.rcd_test_button_ok}
            onChange={(v) => updateField('rcd_test_button_ok', v)}
          />
        </FormSection>

        {/* ── Additional ──────────────────────────────────────────────────── */}
        <FormSection title="Additional" defaultOpen={false}>
          <div className="flex gap-3 flex-wrap">
            <ToggleField
              label="AFDD fitted"
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
      </div>
    </div>
  );
}
