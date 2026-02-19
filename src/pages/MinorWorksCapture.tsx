import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Share2,
  Mic,
  Square,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Zap,
  Shield,
  ClipboardCheck,
  UserCheck,
  Calendar,
} from 'lucide-react';
// SyncIndicator requires full sync service wiring — use inline badge for now
import { useApiToken } from '../hooks/useApiToken';
import useEngineerProfile from '../hooks/useEngineerProfile';
import { saveCertificate, getCertificate } from '../services/offlineStore';
import type { EICRCertificate } from '../types/eicr';
import type {
  MinorWorksCertificate,
  MinorWorksDescription,
  MinorWorksInstallation,
  MinorWorksCircuit,
  MinorWorksTestResults,
  MinorWorksDeclaration,
  MinorWorksNextInspection,
} from '../types/minorWorks';
import {
  EMPTY_MW_DESCRIPTION,
  EMPTY_MW_INSTALLATION,
  EMPTY_MW_CIRCUIT,
  EMPTY_MW_TEST_RESULTS,
  EMPTY_MW_DECLARATION,
  EMPTY_MW_NEXT_INSPECTION,
  EMPTY_SCHEME_NOTIFICATION,
} from '../types/minorWorks';
import type { ClientDetails, TestInstruments } from '../types/eicr';
import { generateMinorWorksBlobUrl } from '../services/minorWorksPdf';

// ── Section collapse state ──────────────────────────────────────
type SectionKey =
  | 'description'
  | 'installation'
  | 'circuit'
  | 'testResults'
  | 'declaration'
  | 'nextInspection';

const SECTION_META: { key: SectionKey; label: string; icon: React.ElementType }[] = [
  { key: 'description', label: 'Description of Works', icon: FileText },
  { key: 'installation', label: 'Installation Details', icon: Zap },
  { key: 'circuit', label: 'Circuit Details', icon: Shield },
  { key: 'testResults', label: 'Test Results', icon: ClipboardCheck },
  { key: 'declaration', label: 'Declaration', icon: UserCheck },
  { key: 'nextInspection', label: 'Next Inspection', icon: Calendar },
];

// ── Earthing type options ───────────────────────────────────────
const EARTHING_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: 'TN_C', label: 'TN-C' },
  { value: 'TN_S', label: 'TN-S' },
  { value: 'TN_C_S', label: 'TN-C-S' },
  { value: 'TT', label: 'TT' },
  { value: 'IT', label: 'IT' },
];

// ── Validation ──────────────────────────────────────────────────
interface ValidationWarning {
  section: SectionKey;
  message: string;
}

function getValidationWarnings(cert: MinorWorksCertificate): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (!cert.description.descriptionOfWork.trim()) {
    warnings.push({ section: 'description', message: 'Description of work not entered' });
  }
  if (!cert.description.dateOfCompletion) {
    warnings.push({ section: 'description', message: 'Date of completion not set' });
  }
  if (!cert.installation.earthingType) {
    warnings.push({ section: 'installation', message: 'Earthing type not selected' });
  }
  if (!cert.circuit.circuitDescription.trim()) {
    warnings.push({ section: 'circuit', message: 'Circuit description not entered' });
  }
  if (!cert.circuit.protectiveDevice.rating) {
    warnings.push({ section: 'circuit', message: 'Protective device rating not set' });
  }
  if (!cert.testResults.earthContinuity.r1PlusR2) {
    warnings.push({ section: 'testResults', message: 'R1+R2 not recorded' });
  }
  if (!cert.testResults.insulationResistance.liveToEarth) {
    warnings.push({ section: 'testResults', message: 'Insulation resistance (L-E) not recorded' });
  }
  if (!cert.testResults.earthFaultLoopImpedance.zs) {
    warnings.push({ section: 'testResults', message: 'Zs not recorded' });
  }
  if (!cert.testResults.polarity) {
    warnings.push({ section: 'testResults', message: 'Polarity not confirmed' });
  }
  if (!cert.declaration.installerName.trim()) {
    warnings.push({ section: 'declaration', message: 'Installer name not set' });
  }
  if (!cert.declaration.schemeProvider.trim()) {
    warnings.push({ section: 'declaration', message: 'Scheme provider not set' });
  }

  return warnings;
}

// ── Helper: convert MinorWorksCertificate to storable data ──────
// offlineStore expects Partial<EICRCertificate>. We cast through unknown
// since IndexedDB doesn't enforce types — it stores whatever JS object we give it.
function toStorable(cert: MinorWorksCertificate): Partial<EICRCertificate> {
  return cert as unknown as Partial<EICRCertificate>;
}

function fromStorable(data: Partial<EICRCertificate>): MinorWorksCertificate | null {
  const raw = data as unknown as Record<string, unknown>;
  if (raw.certificateType !== 'MINOR_WORKS') return null;
  return raw as unknown as MinorWorksCertificate;
}

// ── Component ───────────────────────────────────────────────────
export default function MinorWorksCapture() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getTokenSafe } = useApiToken();
  const { profile } = useEngineerProfile();

  // Cert state
  const [cert, setCert] = useState<MinorWorksCertificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'saved' | 'syncing' | 'offline' | 'error'>('saved');
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(
    new Set(['description', 'circuit', 'testResults'])
  );
  const [showWarnings, setShowWarnings] = useState(false);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // ── Initialize certificate ──────────────────────────────────
  useEffect(() => {
    async function init() {
      if (!id) return;

      // Try loading existing cert from IndexedDB
      const stored = await getCertificate(id);
      if (stored) {
        const mwCert = fromStorable(stored.data);
        if (mwCert) {
          setCert(mwCert);
          setLoading(false);
          return;
        }
      }

      // Create new from navigation state
      const navState = location.state as {
        clientDetails?: ClientDetails;
      } | null;

      const emptyInstruments: TestInstruments = {
        multifunctionInstrument: '',
        insulationResistance: '',
        continuity: '',
        earthElectrodeResistance: '',
        earthFaultLoopImpedance: '',
        rcdTester: '',
      };

      const newCert: MinorWorksCertificate = {
        certificateType: 'MINOR_WORKS',
        id,
        engineerId: '',
        status: 'DRAFT',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        clientDetails: navState?.clientDetails ?? {
          clientName: '',
          clientAddress: '',
        },
        description: { ...EMPTY_MW_DESCRIPTION },
        installation: { ...EMPTY_MW_INSTALLATION },
        circuit: { ...EMPTY_MW_CIRCUIT },
        testResults: { ...EMPTY_MW_TEST_RESULTS },
        testInstruments: profile?.testInstruments ?? emptyInstruments,
        declaration: {
          ...EMPTY_MW_DECLARATION,
          contractorName: profile?.companyName ?? '',
          installerName: profile?.fullName ?? '',
          schemeProvider: profile?.schemeBody ?? '',
          schemeMembershipNumber: profile?.registrationNumber ?? '',
        },
        nextInspection: { ...EMPTY_MW_NEXT_INSPECTION },
        schemeNotification: { ...EMPTY_SCHEME_NOTIFICATION },
      };

      await saveCertificate(id, toStorable(newCert));
      setCert(newCert);
      setLoading(false);
    }

    init();
  }, [id, location.state, profile]);

  // ── Auto-save on every change ───────────────────────────────
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>();
  const persist = useCallback(
    (updated: MinorWorksCertificate) => {
      setCert(updated);
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(async () => {
        const toSave = { ...updated, updatedAt: new Date().toISOString() };
        await saveCertificate(toSave.id, toStorable(toSave));
        setSyncStatus('saved');
      }, 400);
    },
    []
  );

  // ── Section updaters ────────────────────────────────────────
  const updateDescription = useCallback(
    (patch: Partial<MinorWorksDescription>) => {
      if (!cert) return;
      persist({ ...cert, description: { ...cert.description, ...patch } });
    },
    [cert, persist]
  );

  const updateInstallation = useCallback(
    (patch: Partial<MinorWorksInstallation>) => {
      if (!cert) return;
      persist({ ...cert, installation: { ...cert.installation, ...patch } });
    },
    [cert, persist]
  );

  const updateCircuit = useCallback(
    (patch: Partial<MinorWorksCircuit>) => {
      if (!cert) return;
      persist({ ...cert, circuit: { ...cert.circuit, ...patch } });
    },
    [cert, persist]
  );

  const updateTestResults = useCallback(
    (patch: Partial<MinorWorksTestResults>) => {
      if (!cert) return;
      persist({ ...cert, testResults: { ...cert.testResults, ...patch } });
    },
    [cert, persist]
  );

  const updateDeclaration = useCallback(
    (patch: Partial<MinorWorksDeclaration>) => {
      if (!cert) return;
      persist({ ...cert, declaration: { ...cert.declaration, ...patch } });
    },
    [cert, persist]
  );

  const updateNextInspection = useCallback(
    (patch: Partial<MinorWorksNextInspection>) => {
      if (!cert) return;
      persist({ ...cert, nextInspection: { ...cert.nextInspection, ...patch } });
    },
    [cert, persist]
  );

  // ── Section toggle ──────────────────────────────────────────
  const toggleSection = useCallback((key: SectionKey) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Voice capture (circuit + test results) ──────────────────
  const startVoiceCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        setIsRecording(false);
        setVoiceTranscript('Transcribing...');

        try {
          const token = await getTokenSafe();
          if (!token) {
            setVoiceTranscript('Auth required — please sign in');
            return;
          }

          const apiBase = import.meta.env.VITE_API_BASE_URL || '';

          // Step 1: Transcribe audio → text
          const formData = new FormData();
          formData.append('audio', audioBlob);
          const transcribeRes = await fetch(`${apiBase}/api/speech/transcribe`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });

          if (!transcribeRes.ok) {
            setVoiceTranscript('Transcription failed — enter manually');
            return;
          }

          const { transcript } = await transcribeRes.json();
          if (!transcript || transcript.trim().length < 5) {
            setVoiceTranscript('No speech detected — try again');
            return;
          }

          setVoiceTranscript(`"${transcript}" — extracting...`);

          // Step 2: Send transcript to Claude proxy for structured extraction
          const extractRes = await fetch(`${apiBase}/api/extract`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              transcript,
              locationContext: '',
              dbContext: cert?.circuit.dbReference || '',
              existingCircuits: [],
              earthingType: cert?.installation.earthingType || null,
            }),
          });

          if (!extractRes.ok) {
            setVoiceTranscript(`"${transcript}" — extraction failed, enter manually`);
            return;
          }

          const data = await extractRes.json();
          setVoiceTranscript(`"${transcript}"`);

          // Map EICR-style extraction to Minor Works fields
          if (data.type === 'circuit' && data.circuit) {
            const c = data.circuit;
            const circuitPatch: Partial<MinorWorksCircuit> = {};
            const testPatch: Partial<MinorWorksTestResults> = {};

            // ── Circuit fields ──
            if (c.circuitDescription) circuitPatch.circuitDescription = c.circuitDescription;

            // Protective device
            if (c.ocpdBsEn || c.ocpdType || c.ocpdRating) {
              circuitPatch.protectiveDevice = {
                ...(cert?.circuit.protectiveDevice ?? { bs: '', type: '', rating: '' }),
                ...(c.ocpdBsEn ? { bs: c.ocpdBsEn } : {}),
                ...(c.ocpdType ? { type: c.ocpdType } : {}),
                ...(c.ocpdRating ? { rating: String(c.ocpdRating) } : {}),
              };
            }

            // Wiring system — map cable type from wiring type code
            if (c.liveConductorCsa || c.wiringType || c.referenceMethod) {
              const cableTypeMap: Record<string, string> = {
                A: 'T+E', B: 'SWA', F: 'SWA', H: 'MI',
              };
              circuitPatch.wiringSystem = {
                ...(cert?.circuit.wiringSystem ?? { cableType: '', csa: '', referenceMethod: '' }),
                ...(c.liveConductorCsa ? { csa: String(c.liveConductorCsa) } : {}),
                ...(c.wiringType && cableTypeMap[c.wiringType] ? { cableType: cableTypeMap[c.wiringType] } : {}),
                ...(c.referenceMethod ? { referenceMethod: c.referenceMethod } : {}),
              };
            }

            // ── Test result fields ──
            if (c.r1r2 != null) {
              testPatch.earthContinuity = {
                ...(cert?.testResults.earthContinuity ?? { r1PlusR2: '', r2: '' }),
                r1PlusR2: String(c.r1r2),
              };
            }
            if (c.irLiveEarth != null || c.irLiveLive != null) {
              testPatch.insulationResistance = {
                ...(cert?.testResults.insulationResistance ?? { liveToEarth: '', liveToNeutral: '' }),
                ...(c.irLiveEarth != null ? { liveToEarth: String(c.irLiveEarth) } : {}),
                ...(c.irLiveLive != null ? { liveToNeutral: String(c.irLiveLive) } : {}),
              };
            }
            if (c.zs != null) {
              testPatch.earthFaultLoopImpedance = {
                ...(cert?.testResults.earthFaultLoopImpedance ?? { zs: '', zsValid: null }),
                zs: String(c.zs),
              };
            }
            if (c.polarity) {
              testPatch.polarity = c.polarity === 'TICK' ? 'satisfactory' : 'unsatisfactory';
            }
            if (c.rcdDisconnectionTime != null) {
              testPatch.rcd = {
                ...(cert?.testResults.rcd ?? { present: false, ratedResidualCurrent: '', operatingTime: '' }),
                present: true,
                operatingTime: String(c.rcdDisconnectionTime),
                ...(c.rcdRating != null ? { ratedResidualCurrent: String(c.rcdRating) } : {}),
              };
            }

            // ── Apply both patches in one update to avoid stale state ──
            console.log('PATCHES:', JSON.stringify(circuitPatch), JSON.stringify(testPatch));if (Object.keys(circuitPatch).length > 0 || Object.keys(testPatch).length > 0) {
              const updated = { ...cert! };
              if (Object.keys(circuitPatch).length > 0) {
                updated.circuit = { ...updated.circuit, ...circuitPatch };
              }
              if (Object.keys(testPatch).length > 0) {
                updated.testResults = { ...updated.testResults, ...testPatch };
              }
              persist(updated);
            }
          }
        } catch {
          setVoiceTranscript('Voice extraction failed — enter manually');
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setVoiceTranscript('');
    } catch {
      setVoiceTranscript('Microphone access denied');
    }
  }, [getTokenSafe, cert, persist]);

  const stopVoiceCapture = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  // ── PDF download & share ──────────────────────────────────────
  const pdfBlobRef = useRef<string | null>(null);

  const handleDownloadPdf = useCallback(async () => {
    if (!cert) return;
    try {
      if (pdfBlobRef.current) URL.revokeObjectURL(pdfBlobRef.current);
      const { url, filename } = await generateMinorWorksBlobUrl(cert);
      pdfBlobRef.current = url;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    } catch {
      // PDF generation failed — could add error toast later
    }
  }, [cert]);

  const handleSharePdf = useCallback(async () => {
    if (!cert) return;
    try {
      const { url, filename } = await generateMinorWorksBlobUrl(cert);
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: 'application/pdf' });

      if (navigator.share) {
        try {
          await navigator.share({ files: [file], title: 'Minor Works Certificate' });
          URL.revokeObjectURL(url);
          return;
        } catch {
          // User cancelled or share failed — fall through to mailto
        }
      }

      // Fallback: download + mailto
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      const subject = encodeURIComponent(`Minor Works Certificate — ${cert.clientDetails.clientAddress.split('\n')[0] || ''}`);
      window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent('Please find the Minor Works Certificate attached.')}`;
    } catch {
      // Share failed — could add error toast later
    }
  }, [cert]);

  // ── Render helpers ──────────────────────────────────────────
  if (loading || !cert) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading certificate...</div>
      </div>
    );
  }

  const warnings = getValidationWarnings(cert);
  const isComplete = warnings.length === 0;

  return (
    <>
      <Helmet>
        <title>Minor Works Certificate | CertVoice</title>
      </Helmet>

      <div className="min-h-screen bg-gray-950 text-gray-100">
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="sticky top-0 z-20 bg-gray-900 border-b border-gray-800 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/certificates')}
                className="text-gray-400 hover:text-gray-200 text-sm"
              >
                ← Back
              </button>
              <div>
                <h1 className="text-base font-semibold text-amber-400">Minor Works</h1>
                <p className="text-xs text-gray-500 truncate max-w-[200px]">
                  {cert.clientDetails.clientAddress || 'New certificate'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded-full border ${
                syncStatus === 'saved' ? 'text-green-400 bg-green-400/10 border-green-400/30' :
                syncStatus === 'syncing' ? 'text-amber-400 bg-amber-400/10 border-amber-400/30' :
                syncStatus === 'offline' ? 'text-amber-400 bg-amber-400/10 border-amber-400/30' :
                'text-red-400 bg-red-400/10 border-red-400/30'
              }`}>
                {syncStatus === 'saved' ? 'Saved' : syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'offline' ? 'Offline' : 'Error'}
              </span>
              <button
                onClick={() => setShowWarnings(!showWarnings)}
                className={`p-2 rounded-lg ${
                  isComplete
                    ? 'text-green-400 bg-green-400/10'
                    : 'text-amber-400 bg-amber-400/10'
                }`}
                title={isComplete ? 'Ready to export' : `${warnings.length} warnings`}
              >
                {isComplete ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              </button>
              <button
                onClick={handleDownloadPdf}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                title="Download PDF"
              >
                <Download size={18} />
              </button>
              <button
                onClick={handleSharePdf}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                title="Share"
              >
                <Share2 size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* ── Validation warnings ────────────────────────────── */}
        {showWarnings && warnings.length > 0 && (
          <div className="max-w-2xl mx-auto px-4 pt-3">
            <div className="bg-amber-400/10 border border-amber-400/30 rounded-lg p-3">
              <p className="text-amber-400 text-sm font-medium mb-2">
                {warnings.length} field{warnings.length !== 1 ? 's' : ''} need attention
              </p>
              {warnings.map((w, i) => (
                <p key={i} className="text-amber-300/80 text-xs ml-2">
                  • {w.message}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* ── Voice capture bar ──────────────────────────────── */}
        <div className="max-w-2xl mx-auto px-4 pt-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex items-center gap-3">
            {isRecording ? (
              <button
                onClick={stopVoiceCapture}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors"
              >
                <Square size={16} />
                Stop Recording
              </button>
            ) : (
              <button
                onClick={startVoiceCapture}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 rounded-lg text-sm font-medium transition-colors"
              >
                <Mic size={16} />
                Voice Capture
              </button>
            )}
            <p className="text-xs text-gray-500 flex-1">
              {voiceTranscript
                ? voiceTranscript
                : isRecording
                  ? 'Speak your circuit details and test results...'
                  : 'Tap to capture circuit + test results by voice'}
            </p>
          </div>
        </div>

        {/* ── Form sections ──────────────────────────────────── */}
        <main className="max-w-2xl mx-auto px-4 py-4 space-y-3 pb-24">
          {SECTION_META.map(({ key, label, icon: Icon }) => {
            const isOpen = expandedSections.has(key);
            const sectionWarnings = warnings.filter((w) => w.section === key);

            return (
              <section
                key={key}
                className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => toggleSection(key)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors"
                >
                  <Icon size={18} className="text-amber-400 shrink-0" />
                  <span className="text-sm font-medium flex-1 text-left">{label}</span>
                  {sectionWarnings.length > 0 && (
                    <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                      {sectionWarnings.length}
                    </span>
                  )}
                  {isOpen ? (
                    <ChevronDown size={16} className="text-gray-500" />
                  ) : (
                    <ChevronRight size={16} className="text-gray-500" />
                  )}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-800 pt-3">
                    {key === 'description' && (
                      <DescriptionSection
                        data={cert.description}
                        onChange={updateDescription}
                      />
                    )}
                    {key === 'installation' && (
                      <InstallationSection
                        data={cert.installation}
                        onChange={updateInstallation}
                      />
                    )}
                    {key === 'circuit' && (
                      <CircuitSection data={cert.circuit} onChange={updateCircuit} />
                    )}
                    {key === 'testResults' && (
                      <TestResultsSection
                        data={cert.testResults}
                        onChange={updateTestResults}
                      />
                    )}
                    {key === 'declaration' && (
                      <DeclarationSection
                        data={cert.declaration}
                        onChange={updateDeclaration}
                      />
                    )}
                    {key === 'nextInspection' && (
                      <NextInspectionSection
                        data={cert.nextInspection}
                        onChange={updateNextInspection}
                      />
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </main>
      </div>
    </>
  );
}

// ── Input helper ────────────────────────────────────────────────
function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Section: Description ────────────────────────────────────────
function DescriptionSection({
  data,
  onChange,
}: {
  data: MinorWorksDescription;
  onChange: (patch: Partial<MinorWorksDescription>) => void;
}) {
  return (
    <>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Description of Work</label>
        <textarea
          value={data.descriptionOfWork}
          onChange={(e) => onChange({ descriptionOfWork: e.target.value })}
          placeholder="e.g. Installation of 2No. double sockets in kitchen"
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 resize-none"
        />
      </div>
      <Field
        label="Date of Completion"
        type="date"
        value={data.dateOfCompletion}
        onChange={(v) => onChange({ dateOfCompletion: v })}
      />
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Comments on Existing Installation
        </label>
        <textarea
          value={data.commentsOnExisting}
          onChange={(e) => onChange({ commentsOnExisting: e.target.value })}
          placeholder="Comments on the condition of the existing installation..."
          rows={2}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 resize-none"
        />
      </div>
    </>
  );
}

// ── Section: Installation ───────────────────────────────────────
function InstallationSection({
  data,
  onChange,
}: {
  data: MinorWorksInstallation;
  onChange: (patch: Partial<MinorWorksInstallation>) => void;
}) {
  return (
    <>
      <SelectField
        label="Earthing Type"
        value={data.earthingType}
        onChange={(v) => onChange({ earthingType: v as MinorWorksInstallation['earthingType'] })}
        options={EARTHING_OPTIONS}
      />
      <Field
        label="Method of Fault Protection"
        value={data.methodOfFaultProtection}
        onChange={(v) => onChange({ methodOfFaultProtection: v })}
        placeholder="ADS"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Existing Protective Device Type"
          value={data.existingProtectiveDevice.type}
          onChange={(v) =>
            onChange({
              existingProtectiveDevice: { ...data.existingProtectiveDevice, type: v },
            })
          }
          placeholder="e.g. BS EN 60898"
        />
        <Field
          label="Rating (A)"
          value={data.existingProtectiveDevice.rating}
          onChange={(v) =>
            onChange({
              existingProtectiveDevice: { ...data.existingProtectiveDevice, rating: v },
            })
          }
          placeholder="e.g. 63"
        />
      </div>
    </>
  );
}

// ── Section: Circuit ────────────────────────────────────────────
function CircuitSection({
  data,
  onChange,
}: {
  data: MinorWorksCircuit;
  onChange: (patch: Partial<MinorWorksCircuit>) => void;
}) {
  return (
    <>
      <Field
        label="Circuit Description"
        value={data.circuitDescription}
        onChange={(v) => onChange({ circuitDescription: v })}
        placeholder="e.g. Kitchen sockets"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="DB Reference"
          value={data.dbReference}
          onChange={(v) => onChange({ dbReference: v })}
          placeholder="e.g. DB1"
        />
        <Field
          label="Circuit Designation"
          value={data.circuitDesignation}
          onChange={(v) => onChange({ circuitDesignation: v })}
          placeholder="e.g. 6"
        />
      </div>

      <p className="text-xs text-gray-500 font-medium mt-2">Protective Device</p>
      <div className="grid grid-cols-3 gap-3">
        <Field
          label="BS Standard"
          value={data.protectiveDevice.bs}
          onChange={(v) =>
            onChange({ protectiveDevice: { ...data.protectiveDevice, bs: v } })
          }
          placeholder="BS EN 60898"
        />
        <Field
          label="Type"
          value={data.protectiveDevice.type}
          onChange={(v) =>
            onChange({ protectiveDevice: { ...data.protectiveDevice, type: v } })
          }
          placeholder="B"
        />
        <Field
          label="Rating (A)"
          value={data.protectiveDevice.rating}
          onChange={(v) =>
            onChange({ protectiveDevice: { ...data.protectiveDevice, rating: v } })
          }
          placeholder="32"
        />
      </div>

      <p className="text-xs text-gray-500 font-medium mt-2">Wiring System</p>
      <div className="grid grid-cols-3 gap-3">
        <Field
          label="Cable Type"
          value={data.wiringSystem.cableType}
          onChange={(v) =>
            onChange({ wiringSystem: { ...data.wiringSystem, cableType: v } })
          }
          placeholder="T+E"
        />
        <Field
          label="CSA (mm²)"
          value={data.wiringSystem.csa}
          onChange={(v) =>
            onChange({ wiringSystem: { ...data.wiringSystem, csa: v } })
          }
          placeholder="2.5"
        />
        <Field
          label="Ref Method"
          value={data.wiringSystem.referenceMethod}
          onChange={(v) =>
            onChange({ wiringSystem: { ...data.wiringSystem, referenceMethod: v } })
          }
          placeholder="C"
        />
      </div>
    </>
  );
}

// ── Section: Test Results ───────────────────────────────────────
function TestResultsSection({
  data,
  onChange,
}: {
  data: MinorWorksTestResults;
  onChange: (patch: Partial<MinorWorksTestResults>) => void;
}) {
  return (
    <>
      <p className="text-xs text-gray-500 font-medium">Earth Continuity</p>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="R1+R2 (Ω)"
          value={data.earthContinuity.r1PlusR2}
          onChange={(v) =>
            onChange({ earthContinuity: { ...data.earthContinuity, r1PlusR2: v } })
          }
          placeholder="0.00"
        />
        <Field
          label="R2 (Ω)"
          value={data.earthContinuity.r2}
          onChange={(v) =>
            onChange({ earthContinuity: { ...data.earthContinuity, r2: v } })
          }
          placeholder="0.00"
        />
      </div>

      <p className="text-xs text-gray-500 font-medium mt-2">Insulation Resistance</p>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Live to Earth (MΩ)"
          value={data.insulationResistance.liveToEarth}
          onChange={(v) =>
            onChange({
              insulationResistance: { ...data.insulationResistance, liveToEarth: v },
            })
          }
          placeholder=">200"
        />
        <Field
          label="Live to Neutral (MΩ)"
          value={data.insulationResistance.liveToNeutral}
          onChange={(v) =>
            onChange({
              insulationResistance: { ...data.insulationResistance, liveToNeutral: v },
            })
          }
          placeholder=">200"
        />
      </div>

      <p className="text-xs text-gray-500 font-medium mt-2">Earth Fault Loop Impedance</p>
      <Field
        label="Zs (Ω)"
        value={data.earthFaultLoopImpedance.zs}
        onChange={(v) =>
          onChange({
            earthFaultLoopImpedance: { ...data.earthFaultLoopImpedance, zs: v },
          })
        }
        placeholder="0.00"
      />

      <p className="text-xs text-gray-500 font-medium mt-2">Polarity & Functional Testing</p>
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Polarity"
          value={data.polarity}
          onChange={(v) =>
            onChange({ polarity: v as MinorWorksTestResults['polarity'] })
          }
          options={[
            { value: '', label: 'Select...' },
            { value: 'satisfactory', label: 'Satisfactory' },
            { value: 'unsatisfactory', label: 'Unsatisfactory' },
          ]}
        />
        <SelectField
          label="Functional Testing"
          value={data.functionalTesting}
          onChange={(v) =>
            onChange({ functionalTesting: v as MinorWorksTestResults['functionalTesting'] })
          }
          options={[
            { value: '', label: 'Select...' },
            { value: 'satisfactory', label: 'Satisfactory' },
            { value: 'unsatisfactory', label: 'Unsatisfactory' },
          ]}
        />
      </div>

      <p className="text-xs text-gray-500 font-medium mt-2">RCD (if applicable)</p>
      <div className="flex items-center gap-3 mb-2">
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={data.rcd.present}
            onChange={(e) => onChange({ rcd: { ...data.rcd, present: e.target.checked } })}
            className="rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500/30"
          />
          RCD present on circuit
        </label>
      </div>
      {data.rcd.present && (
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Rated IΔn (mA)"
            value={data.rcd.ratedResidualCurrent}
            onChange={(v) =>
              onChange({ rcd: { ...data.rcd, ratedResidualCurrent: v } })
            }
            placeholder="30"
          />
          <Field
            label="Operating Time (ms)"
            value={data.rcd.operatingTime}
            onChange={(v) =>
              onChange({ rcd: { ...data.rcd, operatingTime: v } })
            }
            placeholder="18"
          />
        </div>
      )}
    </>
  );
}

// ── Section: Declaration ────────────────────────────────────────
function DeclarationSection({
  data,
  onChange,
}: {
  data: MinorWorksDeclaration;
  onChange: (patch: Partial<MinorWorksDeclaration>) => void;
}) {
  return (
    <>
      <Field
        label="Contractor / Company Name"
        value={data.contractorName}
        onChange={(v) => onChange({ contractorName: v })}
      />
      <Field
        label="Address"
        value={data.contractorAddress}
        onChange={(v) => onChange({ contractorAddress: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Telephone"
          value={data.contractorTelephone}
          onChange={(v) => onChange({ contractorTelephone: v })}
          type="tel"
        />
        <Field
          label="Email"
          value={data.contractorEmail}
          onChange={(v) => onChange({ contractorEmail: v })}
          type="email"
        />
      </div>
      <Field
        label="Installer Name"
        value={data.installerName}
        onChange={(v) => onChange({ installerName: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Scheme Provider"
          value={data.schemeProvider}
          onChange={(v) => onChange({ schemeProvider: v })}
          placeholder="e.g. NAPIT"
        />
        <Field
          label="Membership Number"
          value={data.schemeMembershipNumber}
          onChange={(v) => onChange({ schemeMembershipNumber: v })}
        />
      </div>
      <Field
        label="Date"
        type="date"
        value={data.installerDate}
        onChange={(v) => onChange({ installerDate: v })}
      />
    </>
  );
}

// ── Section: Next Inspection ────────────────────────────────────
function NextInspectionSection({
  data,
  onChange,
}: {
  data: MinorWorksNextInspection;
  onChange: (patch: Partial<MinorWorksNextInspection>) => void;
}) {
  return (
    <>
      <Field
        label="Recommended Date"
        type="date"
        value={data.recommendedDate}
        onChange={(v) => onChange({ recommendedDate: v })}
      />
      <Field
        label="Reason"
        value={data.reason}
        onChange={(v) => onChange({ reason: v })}
        placeholder="e.g. Change of occupancy / 10 years (domestic)"
      />
    </>
  );
}
