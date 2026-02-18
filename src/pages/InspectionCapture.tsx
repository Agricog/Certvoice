/**
 * CertVoice — InspectionCapture Page (with Persistence + Offline)
 *
 * Main capture workflow for an EICR inspection.
 * Orchestrates 5 tabs: Circuits, Observations, Supply, Checklist, Declaration.
 *
 * Persistence strategy:
 *   1. On mount: load certificate from API (online) or IndexedDB (offline)
 *   2. Every change: save to IndexedDB immediately, trigger background sync
 *   3. SyncIndicator shows saved/syncing/offline/error status
 *   4. Certificate created via API on first load if new
 *
 * @module pages/InspectionCapture
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocation, useParams, useNavigate, Link } from 'react-router-dom'
import { useApiToken } from '../hooks/useApiToken'
import { Helmet } from 'react-helmet-async'
import {
  ArrowLeft,
  Zap,
  CircuitBoard,
  AlertTriangle,
  Settings2,
  ClipboardList,
  Plus,
  Save,
  Loader2,
  Mic,
  Pencil,
  FileSignature,
  Download,
} from 'lucide-react'
import type {
  EICRCertificate,
  CircuitDetail,
  Observation,
  Declaration,
  DistributionBoardHeader,
  SupplyCharacteristics,
  InstallationParticulars,
  InspectionItem,
  InspectionOutcome,
  ClassificationCode,
} from '../types/eicr'
import CircuitRecorder from '../components/CircuitRecorder'
import ObservationRecorder from '../components/ObservationRecorder'
import SupplyDetails from '../components/SupplyDetails'
import InspectionChecklist from '../components/InspectionChecklist'
import SyncIndicator from '../components/SyncIndicator'
import DeclarationForm, { EMPTY_DECLARATION } from '../components/DeclarationForm'
import useEngineerProfile from '../hooks/useEngineerProfile'
import { captureError } from '../utils/errorTracking'
import { trackCircuitCaptured, trackObservationCaptured, trackChecklistProgress } from '../utils/analytics'
import { saveCertificate as saveToLocal, getCertificate as getFromLocal } from '../services/offlineStore'
import { getCertificate as getFromApi, createCertificate } from '../services/certificateApi'
import { createSyncService } from '../services/syncService'
import { generateEICRBlobUrl } from '../services/pdfGenerator'

// ============================================================
// TYPES
// ============================================================

type CaptureTab = 'circuits' | 'observations' | 'supply' | 'checklist' | 'declaration'
type PageState = 'loading' | 'ready' | 'error'
type RecorderMode = 'voice' | 'manual' | null

// ============================================================
// DEFAULTS
// ============================================================

const EMPTY_SUPPLY: SupplyCharacteristics = {
  earthingType: null,
  supplyType: 'AC',
  conductorConfig: '1PH_2WIRE',
  supplyPolarityConfirmed: false,
  otherSourcesPresent: false,
  nominalVoltage: null,
  nominalFrequency: 50,
  ipf: null,
  ze: null,
  supplyDeviceBsEn: '',
  supplyDeviceType: '',
  supplyDeviceRating: null,
}

const EMPTY_PARTICULARS: InstallationParticulars = {
  distributorFacility: false,
  installationElectrode: false,
  electrodeType: '',
  electrodeLocation: '',
  electrodeResistance: null,
  mainSwitchLocation: '',
  mainSwitchBsEn: '',
  mainSwitchPoles: null,
  mainSwitchCurrentRating: null,
  mainSwitchDeviceRating: null,
  mainSwitchVoltageRating: null,
  earthingConductorMaterial: 'COPPER',
  earthingConductorCsa: null,
  earthingConductorVerified: false,
  bondingConductorMaterial: 'COPPER',
  bondingConductorCsa: null,
  bondingConductorVerified: false,
  bondingWater: 'NA',
  bondingGas: 'NA',
  bondingOil: 'NA',
  bondingSteel: 'NA',
  bondingLightning: 'NA',
  bondingOther: 'NA',
}

const DEFAULT_BOARDS: DistributionBoardHeader[] = [
  { dbReference: 'DB1', dbLocation: 'Main consumer unit' } as DistributionBoardHeader,
]

// ============================================================
// COMPONENT
// ============================================================

export default function InspectionCapture() {
  const location = useLocation()
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken, getTokenSafe } = useApiToken()

  // --- Engineer profile for DeclarationForm auto-fill ---
  const { profile: engineerProfile } = useEngineerProfile()

  // --- Page state ---
  const [pageState, setPageState] = useState<PageState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  // --- Certificate state ---
  const [certificate, setCertificate] = useState<Partial<EICRCertificate>>({})
  const [activeTab, setActiveTab] = useState<CaptureTab>('circuits')
  const [activeDbIndex, setActiveDbIndex] = useState(0)
  const [recorderMode, setRecorderMode] = useState<RecorderMode>(null)
  const [showObservationRecorder, setShowObservationRecorder] = useState(false)
  const [editingCircuitIndex, setEditingCircuitIndex] = useState<number | null>(null)
  const [editingObsIndex, setEditingObsIndex] = useState<number | null>(null)
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)
  const [pdfReady, setPdfReady] = useState<{ url: string; filename: string } | null>(null)

  // --- PDF export ---
  const handleExportPdf = useCallback(async () => {
    if (pdfReady) {
      URL.revokeObjectURL(pdfReady.url)
      setPdfReady(null)
    }
    setIsExporting(true)
    alert('STEP 1: Starting PDF generation')
    try {
      const result = await generateEICRBlobUrl(certificate as EICRCertificate)
      alert('STEP 2: PDF generated - ' + result.filename)
      setPdfReady(result)
    } catch (err) {
      alert('STEP 3: ERROR - ' + (err instanceof Error ? err.message : String(err)))
      captureError(err, 'InspectionCapture.handleExportPdf')
    } finally {
      setIsExporting(false)
    }
  }, [certificate, pdfReady])

  // --- Transcript toggle (view without entering edit mode) ---
  const toggleTranscript = useCallback((id: string) => {
    setExpandedTranscripts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // --- Sync service ---
  const syncServiceRef = useRef<ReturnType<typeof createSyncService> | null>(null)
  const [syncReady, setSyncReady] = useState(false)

  // --- Persist helper: saves to IndexedDB + triggers sync ---
  const persistCertificate = useCallback(
    async (cert: Partial<EICRCertificate>) => {
      const certId = cert.id
      if (!certId) return
      try {
        await saveToLocal(certId, cert, true)
        syncServiceRef.current?.syncNow()
      } catch (err) {
        captureError(err, 'InspectionCapture.persistCertificate')
      }
    },
    []
  )

  // ============================================================
  // LOAD / CREATE CERTIFICATE ON MOUNT
  // ============================================================

  useEffect(() => {
    const certIdFromUrl = params.id
    const stateCert = (location.state as { certificate?: Partial<EICRCertificate> })?.certificate

    async function loadOrCreate() {
      try {
        // Case 1: Existing certificate ID in URL — load it
        if (certIdFromUrl) {
          // Try API first (freshest data)
          let loaded: Partial<EICRCertificate> | null = null

          try {
            loaded = await getFromApi(getToken, certIdFromUrl)
          } catch {
            // API failed — try IndexedDB
            const local = await getFromLocal(certIdFromUrl)
            if (local) loaded = local.data
          }

          if (loaded) {
            // Merge with local data so we don't lose offline circuits/observations
            try {
              const local = await getFromLocal(certIdFromUrl!)
              if (local?.data) {
                const localData = local.data
                // Keep local circuits/observations if API has none
                if (!loaded.circuits?.length && localData.circuits?.length) {
                  loaded.circuits = localData.circuits
                }
                if (!loaded.observations?.length && localData.observations?.length) {
                  loaded.observations = localData.observations
                }
                if (!loaded.inspectionSchedule?.length && localData.inspectionSchedule?.length) {
                  loaded.inspectionSchedule = localData.inspectionSchedule
                }
                if (!loaded.supplyCharacteristics && localData.supplyCharacteristics) {
                  loaded.supplyCharacteristics = localData.supplyCharacteristics
                }
                if (!loaded.declaration && localData.declaration) {
                  loaded.declaration = localData.declaration
                }
              }
            } catch {
              // Local read failed — continue with API data only
            }
            // Ensure boards exist
            if (!loaded.distributionBoards?.length) {
              loaded.distributionBoards = DEFAULT_BOARDS
            }
            setCertificate(loaded)
            await saveToLocal(certIdFromUrl!, loaded, false)
            setPageState('ready')
            return
          }
        }

        // Case 2: New certificate passed via navigation state
        if (stateCert) {
          // Create on API
          try {
            const created = await createCertificate(getToken, {
              certificateType: 'EICR',
              clientName: stateCert.clientDetails?.clientName ?? undefined,
              clientAddress: stateCert.clientDetails?.clientAddress ?? undefined,
              installationAddress: stateCert.installationDetails?.installationAddress ?? undefined,
              purpose: stateCert.reportReason?.purpose ?? undefined,
              premisesType: stateCert.installationDetails?.premisesType ?? undefined,
              extentOfInspection: stateCert.extentAndLimitations?.extentCovered ?? undefined,
              agreedLimitations: stateCert.extentAndLimitations?.agreedLimitations ?? undefined,
              operationalLimitations: stateCert.extentAndLimitations?.operationalLimitations ?? undefined,
            })

            const newCert: Partial<EICRCertificate> = {
              ...stateCert,
              id: created.id,
              reportNumber: created.reportNumber,
              status: created.status as EICRCertificate['status'],
              distributionBoards: stateCert.distributionBoards?.length
                ? stateCert.distributionBoards
                : DEFAULT_BOARDS,
              circuits: [],
              observations: [],
              inspectionSchedule: [],
              createdAt: created.createdAt,
              updatedAt: created.createdAt,
            }

            setCertificate(newCert)
            await saveToLocal(created.id, newCert, false)

            // Update URL to include the new ID
            navigate(`/inspect/${created.id}`, { replace: true })
            setPageState('ready')
            return
          } catch (err) {
            // API failed — create locally with temp ID
            const tempId = stateCert.id ?? crypto.randomUUID()
            const localCert: Partial<EICRCertificate> = {
              ...stateCert,
              id: tempId,
              reportNumber: stateCert.reportNumber ?? `CV-${Date.now().toString(36).toUpperCase()}`,
              status: 'DRAFT' as const,
              distributionBoards: stateCert.distributionBoards?.length
                ? stateCert.distributionBoards
                : DEFAULT_BOARDS,
              circuits: [],
              observations: [],
              inspectionSchedule: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }

            setCertificate(localCert)
            await saveToLocal(tempId, localCert, true)
            navigate(`/inspect/${tempId}`, { replace: true })
            setPageState('ready')
            captureError(err, 'InspectionCapture.createCertificate.apiDown')
            return
          }
        }

        // Case 3: No ID and no state — shouldn't happen, redirect
        navigate('/', { replace: true })
      } catch (err) {
        captureError(err, 'InspectionCapture.loadOrCreate')
        setLoadError('Failed to load certificate. Please try again.')
        setPageState('error')
      }
    }

    loadOrCreate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ============================================================
  // SYNC SERVICE LIFECYCLE
  // ============================================================

  useEffect(() => {
    const service = createSyncService(getTokenSafe)
    syncServiceRef.current = service
    setSyncReady(true)
    service.start()

    return () => {
      service.stop()
      syncServiceRef.current = null
      setSyncReady(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Derived state ---
  const boards = certificate.distributionBoards ?? []
  const activeBoard = boards[activeDbIndex]
  const circuits = certificate.circuits ?? []
  const observations = certificate.observations ?? []
  const supply = certificate.supplyCharacteristics ?? EMPTY_SUPPLY
  const particulars = certificate.installationParticulars ?? EMPTY_PARTICULARS
  const inspectionItems = certificate.inspectionSchedule ?? []
  const earthingType = supply.earthingType

  const boardCircuits = useMemo(
    () => {
      if (!activeBoard?.dbReference) return circuits
      return circuits.filter((c) => c.dbId === activeBoard.dbReference)
    },
    [circuits, activeBoard]
  )

  const obsCounts = useMemo(() => {
    const counts: Record<ClassificationCode, number> = { C1: 0, C2: 0, C3: 0, FI: 0 }
    observations.forEach((o) => {
      if (o.classificationCode && counts[o.classificationCode] !== undefined) {
        counts[o.classificationCode]++
      }
    })
    return counts
  }, [observations])

  const hasUnsatisfactory = obsCounts.C1 > 0 || obsCounts.C2 > 0 || obsCounts.FI > 0

  // ============================================================
  // HANDLERS: CIRCUITS
  // ============================================================

  const handleCircuitConfirmed = useCallback(
    (circuit: Partial<CircuitDetail>) => {
      try {
        const captureMethod = recorderMode ?? 'voice'

        setCertificate((prev) => {
          const existing = [...(prev.circuits ?? [])]
          if (editingCircuitIndex !== null) {
            existing[editingCircuitIndex] = { ...existing[editingCircuitIndex], ...circuit } as CircuitDetail
          } else {
            const newCircuit: CircuitDetail = {
              id: circuit.id ?? crypto.randomUUID(),
              dbId: activeBoard?.dbReference ?? 'DB1',
              circuitNumber: circuit.circuitNumber ?? '',
              circuitDescription: circuit.circuitDescription ?? '',
              wiringType: circuit.wiringType ?? null,
              referenceMethod: circuit.referenceMethod ?? null,
              numberOfPoints: circuit.numberOfPoints ?? null,
              liveConductorCsa: circuit.liveConductorCsa ?? null,
              cpcCsa: circuit.cpcCsa ?? null,
              maxDisconnectTime: circuit.maxDisconnectTime ?? null,
              ocpdBsEn: circuit.ocpdBsEn ?? '',
              ocpdType: circuit.ocpdType ?? null,
              ocpdRating: circuit.ocpdRating ?? null,
              maxPermittedZs: circuit.maxPermittedZs ?? null,
              breakingCapacity: circuit.breakingCapacity ?? null,
              rcdBsEn: circuit.rcdBsEn ?? '',
              rcdType: circuit.rcdType ?? null,
              rcdRating: circuit.rcdRating ?? null,
              r1: circuit.r1 ?? null,
              rn: circuit.rn ?? null,
              r2: circuit.r2 ?? null,
              r1r2: circuit.r1r2 ?? null,
              r1r2OrR2: circuit.r1r2OrR2 ?? null,
              r2Standalone: circuit.r2Standalone ?? null,
              irTestVoltage: circuit.irTestVoltage ?? null,
              irLiveLive: circuit.irLiveLive ?? null,
              irLiveEarth: circuit.irLiveEarth ?? null,
              zs: circuit.zs ?? null,
              polarity: circuit.polarity ?? 'NA',
              rcdDisconnectionTime: circuit.rcdDisconnectionTime ?? null,
              rcdTestButton: circuit.rcdTestButton ?? 'NA',
              afddTestButton: circuit.afddTestButton ?? 'NA',
              remarks: circuit.remarks ?? '',
              circuitType: circuit.circuitType ?? null,
              status: circuit.status ?? 'INCOMPLETE',
              validationWarnings: circuit.validationWarnings ?? [],
              voiceTranscript: circuit.voiceTranscript ?? undefined,
              fieldConfidence: circuit.fieldConfidence ?? undefined,
            }
            existing.push(newCircuit)
          }
          const updated = { ...prev, circuits: existing, updatedAt: new Date().toISOString() }
          // Persist async (fire-and-forget)
          persistCertificate(updated)
          return updated
        })
        trackCircuitCaptured(circuit.circuitType ?? 'UNKNOWN', captureMethod)
        setRecorderMode(null)
        setEditingCircuitIndex(null)
      } catch (error) {
        captureError(error, 'InspectionCapture.handleCircuitConfirmed')
      }
    },
    [editingCircuitIndex, activeBoard, persistCertificate, recorderMode]
  )

  // ============================================================
  // HANDLERS: OBSERVATIONS
  // ============================================================

  const handleObservationConfirmed = useCallback(
    (observation: Partial<Observation>) => {
      try {
        setCertificate((prev) => {
          const existing = [...(prev.observations ?? [])]
          if (editingObsIndex !== null) {
            existing[editingObsIndex] = { ...existing[editingObsIndex], ...observation } as Observation
          } else {
            const newObs: Observation = {
              id: observation.id ?? crypto.randomUUID(),
              itemNumber: existing.length + 1,
              observationText: observation.observationText ?? '',
              classificationCode: observation.classificationCode ?? 'C3',
              dbReference: activeBoard?.dbReference ?? 'DB1',
              circuitReference: observation.circuitReference ?? '',
              location: observation.location ?? '',
              regulationReference: observation.regulationReference ?? '',
              photoKeys: observation.photoKeys ?? [],
              remedialAction: observation.remedialAction ?? '',
              voiceTranscript: observation.voiceTranscript ?? undefined,
              fieldConfidence: observation.fieldConfidence ?? undefined,
            }
            existing.push(newObs)
          }
          const updated = { ...prev, observations: existing, updatedAt: new Date().toISOString() }
          persistCertificate(updated)
          return updated
        })
        trackObservationCaptured(
          observation.classificationCode ?? 'C3',
          (observation.photoKeys?.length ?? 0) > 0
        )
        setShowObservationRecorder(false)
        setEditingObsIndex(null)
      } catch (error) {
        captureError(error, 'InspectionCapture.handleObservationConfirmed')
      }
    },
    [editingObsIndex, activeBoard, persistCertificate]
  )

  // ============================================================
  // HANDLERS: SUPPLY
  // ============================================================

  const handleSupplyChange = useCallback((updated: SupplyCharacteristics) => {
    setCertificate((prev) => {
      const cert = { ...prev, supplyCharacteristics: updated, updatedAt: new Date().toISOString() }
      persistCertificate(cert)
      return cert
    })
  }, [persistCertificate])

  const handleParticularsChange = useCallback((updated: InstallationParticulars) => {
    setCertificate((prev) => {
      const cert = { ...prev, installationParticulars: updated, updatedAt: new Date().toISOString() }
      persistCertificate(cert)
      return cert
    })
  }, [persistCertificate])

  // ============================================================
  // HANDLERS: CHECKLIST
  // ============================================================

  const handleItemChange = useCallback(
    (itemId: string, outcome: InspectionOutcome | null, notes: string) => {
      try {
        setCertificate((prev) => {
          const items = [...(prev.inspectionSchedule ?? [])]
          const idx = items.findIndex((i) => i.id === itemId)
          if (idx >= 0) {
            items[idx] = { ...items[idx], outcome, notes } as InspectionItem
          }
          const completed = items.filter((i) => i.outcome !== null).length
          trackChecklistProgress(completed, items.length)
          const cert = { ...prev, inspectionSchedule: items, updatedAt: new Date().toISOString() }
          persistCertificate(cert)
          return cert
        })
      } catch (error) {
        captureError(error, 'InspectionCapture.handleItemChange')
      }
    },
    [persistCertificate]
  )

  const handleBulkPass = useCallback((sectionNumber: number) => {
    try {
      setCertificate((prev) => {
        const items = [...(prev.inspectionSchedule ?? [])]
        const updated = items.map((item) => {
          if (item.section === sectionNumber && !item.outcome) {
            return { ...item, outcome: 'PASS' as InspectionOutcome }
          }
          return item
        })
        const cert = { ...prev, inspectionSchedule: updated, updatedAt: new Date().toISOString() }
        persistCertificate(cert)
        return cert
      })
    } catch (error) {
      captureError(error, 'InspectionCapture.handleBulkPass')
    }
  }, [persistCertificate])

  // ============================================================
  // HANDLERS: DECLARATION
  // ============================================================

  const declaration = certificate.declaration ?? EMPTY_DECLARATION

  const handleDeclarationChange = useCallback((updated: Declaration) => {
    setCertificate((prev) => {
      const cert = { ...prev, declaration: updated, updatedAt: new Date().toISOString() }
      persistCertificate(cert)
      return cert
    })
  }, [persistCertificate])

  // ============================================================
  // HANDLERS: BOARDS
  // ============================================================

  const handleAddBoard = useCallback(() => {
    setCertificate((prev) => {
      const existing = [...(prev.distributionBoards ?? [])]
      const newRef = `DB${existing.length + 1}`
      existing.push({ dbReference: newRef, dbLocation: '' } as DistributionBoardHeader)
      const cert = { ...prev, distributionBoards: existing }
      persistCertificate(cert)
      return cert
    })
  }, [persistCertificate])

  // ============================================================
  // HANDLERS: MANUAL SAVE
  // ============================================================

  const handleSave = useCallback(() => {
    try {
      persistCertificate(certificate)
    } catch (error) {
      captureError(error, 'InspectionCapture.handleSave')
    }
  }, [certificate, persistCertificate])

  // ============================================================
  // TAB CONFIG
  // ============================================================

  const TABS: { id: CaptureTab; label: string; icon: typeof Zap; count?: number }[] = [
    { id: 'circuits', label: 'Circuits', icon: CircuitBoard, count: circuits.length },
    { id: 'observations', label: 'Observations', icon: AlertTriangle, count: observations.length },
    { id: 'supply', label: 'Supply', icon: Settings2 },
    { id: 'checklist', label: 'Checklist', icon: ClipboardList },
    { id: 'declaration', label: 'Sign', icon: FileSignature },
  ]

  // ============================================================
  // RENDER: LOADING / ERROR
  // ============================================================

  if (pageState === 'loading') {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <Loader2 className="w-8 h-8 text-certvoice-accent animate-spin mx-auto mb-3" />
        <p className="text-sm text-certvoice-muted">Loading certificate...</p>
      </div>
    )
  }

  if (pageState === 'error') {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-certvoice-red mx-auto" />
        <p className="text-sm text-certvoice-red">{loadError ?? 'Something went wrong'}</p>
        <Link to="/" className="cv-btn-secondary inline-block">Back to Dashboard</Link>
      </div>
    )
  }

  // ============================================================
  // RENDER: CIRCUITS TAB
  // ============================================================

  const renderCircuitsTab = () => (
    <div className="space-y-3">
      {/* Board selector */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-1 overflow-x-auto">
          {boards.map((board, idx) => (
            <button
              key={board.dbReference ?? idx}
              type="button"
              onClick={() => setActiveDbIndex(idx)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors ${
                activeDbIndex === idx
                  ? 'bg-certvoice-accent/15 border-certvoice-accent text-certvoice-accent'
                  : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted'
              }`}
            >
              {board.dbReference ?? `DB${idx + 1}`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleAddBoard}
          className="w-7 h-7 rounded-lg border border-certvoice-border flex items-center justify-center
                     text-certvoice-muted hover:text-certvoice-accent hover:border-certvoice-accent transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Board info */}
      {activeBoard && (
        <div className="text-xs text-certvoice-muted">
          {activeBoard.dbLocation ? `Location: ${activeBoard.dbLocation}` : 'No location set'} ·{' '}
          {boardCircuits.length} circuit{boardCircuits.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Circuit list */}
      {boardCircuits.length === 0 ? (
        <div className="cv-panel text-center py-8">
          <CircuitBoard className="w-6 h-6 text-certvoice-muted/40 mx-auto mb-2" />
          <p className="text-xs text-certvoice-muted">No circuits captured yet</p>
          <p className="text-[10px] text-certvoice-muted/60 mt-1">
            Record by voice or type values manually
          </p>
        </div>
      ) : (
        boardCircuits.map((circuit, idx) => {
          const globalIdx = circuits.findIndex(
            (c) => c.id === circuit.id
          )
          const isPass = circuit.status === 'SATISFACTORY'
          return (
            <div key={circuit.id ?? `${circuit.circuitNumber}-${idx}`} className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  setEditingCircuitIndex(globalIdx)
                  setRecorderMode('manual')
                }}
                className="cv-panel w-full text-left p-3 hover:border-certvoice-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-certvoice-text">
                      Cct {circuit.circuitNumber}
                    </span>
                    <span className="text-xs text-certvoice-muted ml-2">
                      {circuit.circuitDescription ?? ''}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      isPass ? 'cv-badge-pass' : 'cv-badge-fail'
                    }`}
                  >
                    {circuit.status ?? 'INCOMPLETE'}
                  </span>
                </div>
                {circuit.zs !== null && circuit.zs !== undefined && (
                  <div className="text-[10px] text-certvoice-muted mt-1">
                    Zs: {circuit.zs}Ω{circuit.r1r2 ? ` · R1+R2: ${circuit.r1r2}Ω` : ''}
                    {circuit.rcdDisconnectionTime ? ` · RCD: ${circuit.rcdDisconnectionTime}ms` : ''}
                  </div>
                )}
                {circuit.remarks && (
                  <div className="text-[10px] text-certvoice-muted mt-1">
                    {circuit.remarks}
                  </div>
                )}
              </button>
              {circuit.voiceTranscript && (
                <button
                  type="button"
                  onClick={() => toggleTranscript(circuit.id)}
                  className="flex items-center gap-1 px-3 py-1 text-[10px] text-certvoice-muted hover:text-certvoice-accent transition-colors"
                >
                  <Mic className="w-2.5 h-2.5" />
                  {expandedTranscripts.has(circuit.id) ? 'Hide' : 'View'} transcript
                </button>
              )}
              {expandedTranscripts.has(circuit.id) && circuit.voiceTranscript && (
                <div className="bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2">
                  <p className="text-[10px] text-certvoice-muted font-mono leading-relaxed whitespace-pre-wrap">
                    {circuit.voiceTranscript}
                  </p>
                </div>
              )}
            </div>
          )
        })
      )}

      {/* Add circuit buttons — voice + manual */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => {
            setEditingCircuitIndex(null)
            setRecorderMode('voice')
          }}
          className="cv-btn-primary flex-1 flex items-center justify-center gap-2"
        >
          <Mic className="w-4 h-4" />
          Record Circuit
        </button>
        <button
          type="button"
          onClick={() => {
            setEditingCircuitIndex(null)
            setRecorderMode('manual')
          }}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold
                     bg-certvoice-surface-2 border border-certvoice-border text-certvoice-text
                     hover:border-certvoice-accent hover:text-certvoice-accent transition-colors"
        >
          <Pencil className="w-4 h-4" />
          Manual Entry
        </button>
      </div>

      {/* Circuit Recorder — voice or manual mode */}
      {recorderMode && (
        <CircuitRecorder
          mode={recorderMode}
          locationContext={activeBoard?.dbLocation ?? ''}
          dbContext={activeBoard?.dbReference ?? 'DB1'}
          existingCircuits={boardCircuits.map((c) => c.circuitNumber ?? '')}
          earthingType={earthingType}
          onCircuitConfirmed={handleCircuitConfirmed}
          onCancel={() => {
            setRecorderMode(null)
            setEditingCircuitIndex(null)
          }}
        />
      )}
    </div>
  )

  // ============================================================
  // RENDER: OBSERVATIONS TAB
  // ============================================================

  const renderObservationsTab = () => (
    <div className="space-y-3">
      {observations.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {obsCounts.C1 > 0 && (
            <span className="cv-code-c1 text-xs px-2 py-1 rounded font-semibold">C1: {obsCounts.C1}</span>
          )}
          {obsCounts.C2 > 0 && (
            <span className="cv-code-c2 text-xs px-2 py-1 rounded font-semibold">C2: {obsCounts.C2}</span>
          )}
          {obsCounts.C3 > 0 && (
            <span className="cv-code-c3 text-xs px-2 py-1 rounded font-semibold">C3: {obsCounts.C3}</span>
          )}
          {obsCounts.FI > 0 && (
            <span className="cv-code-fi text-xs px-2 py-1 rounded font-semibold">FI: {obsCounts.FI}</span>
          )}
          {hasUnsatisfactory && (
            <span className="cv-badge-fail text-[10px] ml-auto">UNSATISFACTORY</span>
          )}
        </div>
      )}

      {observations.length === 0 ? (
        <div className="cv-panel text-center py-8">
          <AlertTriangle className="w-6 h-6 text-certvoice-muted/40 mx-auto mb-2" />
          <p className="text-xs text-certvoice-muted">No observations recorded</p>
          <p className="text-[10px] text-certvoice-muted/60 mt-1">Voice-capture defects to add them</p>
        </div>
      ) : (
        observations.map((obs, idx) => (
          <div key={obs.id ?? `obs-${obs.itemNumber}-${idx}`} className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setEditingObsIndex(idx)
                setShowObservationRecorder(true)
              }}
              className="cv-panel w-full text-left p-3 hover:border-certvoice-accent/50 transition-colors"
            >
              <div className="flex items-start gap-2">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 mt-0.5 ${
                    obs.classificationCode === 'C1' ? 'cv-code-c1'
                      : obs.classificationCode === 'C2' ? 'cv-code-c2'
                      : obs.classificationCode === 'C3' ? 'cv-code-c3'
                      : 'cv-code-fi'
                  }`}
                >
                  {obs.classificationCode}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-certvoice-text line-clamp-2">{obs.observationText ?? ''}</div>
                  {obs.regulationReference && (
                    <div className="text-[10px] text-certvoice-muted mt-1 font-mono">{obs.regulationReference}</div>
                  )}
                </div>
              </div>
            </button>
            {obs.voiceTranscript && (
              <button
                type="button"
                onClick={() => toggleTranscript(obs.id)}
                className="flex items-center gap-1 px-3 py-1 text-[10px] text-certvoice-muted hover:text-certvoice-accent transition-colors"
              >
                <Mic className="w-2.5 h-2.5" />
                {expandedTranscripts.has(obs.id) ? 'Hide' : 'View'} transcript
              </button>
            )}
            {expandedTranscripts.has(obs.id) && obs.voiceTranscript && (
              <div className="bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2">
                <p className="text-[10px] text-certvoice-muted font-mono leading-relaxed whitespace-pre-wrap">
                  {obs.voiceTranscript}
                </p>
              </div>
            )}
          </div>
        ))
      )}

      <button
        type="button"
        onClick={() => {
          setEditingObsIndex(null)
          setShowObservationRecorder(true)
        }}
        className="cv-btn-primary w-full flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Record Observation
      </button>

      {showObservationRecorder && (
        <ObservationRecorder
          certificateId={certificate.id ?? ''}
          locationContext={activeBoard?.dbLocation ?? ''}
          dbContext={activeBoard?.dbReference ?? 'DB1'}
          nextItemNumber={observations.length + 1}
          earthingType={earthingType}
          existingCircuits={boardCircuits.map((c) => c.circuitNumber ?? '')}
          editingObservation={editingObsIndex !== null ? observations[editingObsIndex] ?? null : null}
          onObservationConfirmed={handleObservationConfirmed}
          onCancel={() => {
            setShowObservationRecorder(false)
            setEditingObsIndex(null)
          }}
        />
      )}
    </div>
  )

  // ============================================================
  // RENDER: SUPPLY + CHECKLIST TABS
  // ============================================================

  const renderSupplyTab = () => (
    <SupplyDetails
      supply={supply}
      particulars={particulars}
      onSupplyChange={handleSupplyChange}
      onParticularsChange={handleParticularsChange}
    />
  )

  const renderChecklistTab = () => (
    <InspectionChecklist
      items={inspectionItems}
      onItemChange={handleItemChange}
      onBulkPass={handleBulkPass}
    />
  )

  // ============================================================
  // RENDER: DECLARATION TAB
  // ============================================================

  const renderDeclarationTab = () => (
    <DeclarationForm
      certificateId={certificate.id ?? ''}
      declaration={declaration}
      onDeclarationChange={handleDeclarationChange}
      engineerProfile={engineerProfile}
      disabled={certificate.status === 'ISSUED'}
    />
  )

  // ============================================================
  // RENDER: MAIN
  // ============================================================

  const tabRenderers: Record<CaptureTab, () => JSX.Element> = {
    circuits: renderCircuitsTab,
    observations: renderObservationsTab,
    supply: renderSupplyTab,
    checklist: renderChecklistTab,
    declaration: renderDeclarationTab,
  }

  const address = certificate.installationDetails?.installationAddress ?? 'New Inspection'

  return (
    <>
      <Helmet>
        <title>Inspection | CertVoice</title>
        <meta name="description" content="EICR inspection capture" />
      </Helmet>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* ---- Header ---- */}
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                       text-certvoice-muted hover:text-certvoice-text hover:border-certvoice-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-certvoice-text truncate flex items-center gap-2">
              <Zap className="w-4 h-4 text-certvoice-accent shrink-0" />
              {address}
            </h1>
            <p className="text-[10px] text-certvoice-muted">
              {certificate.reportNumber ?? ''} ·{' '}
              {certificate.clientDetails?.clientName ?? ''}
            </p>
          </div>
          {syncReady && syncServiceRef.current && (
            <SyncIndicator
              onStatusChange={syncServiceRef.current.onStatusChange}
              onSyncNow={() => syncServiceRef.current?.syncNow()}
            />
          )}
          {pdfReady ? (
            <a
              href={pdfReady.url}
              download={pdfReady.filename}
              onClick={() => setTimeout(() => {
                URL.revokeObjectURL(pdfReady.url)
                setPdfReady(null)
              }, 5000)}
              className="w-8 h-8 rounded-lg border border-certvoice-green flex items-center justify-center
                         text-certvoice-green hover:bg-certvoice-green/10 transition-colors animate-pulse"
              title="Download PDF"
            >
              <Download className="w-4 h-4" />
            </a>
          ) : (
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isExporting}
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-accent hover:border-certvoice-accent transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
              title="Export PDF"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                       text-certvoice-muted hover:text-certvoice-green hover:border-certvoice-green transition-colors"
            title="Save progress"
          >
            <Save className="w-4 h-4" />
          </button>
        </div>

        {/* ---- Overall Status ---- */}
        {hasUnsatisfactory && (
          <div className="cv-panel border-certvoice-red/30 bg-certvoice-red/5 p-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-certvoice-red shrink-0" />
            <span className="text-xs text-certvoice-red font-semibold">
              UNSATISFACTORY — C1/C2/FI observations recorded
            </span>
          </div>
        )}

        {/* ---- Tabs ---- */}
        <div className="flex gap-1 bg-certvoice-surface border border-certvoice-border rounded-lg p-1">
          {TABS.map((tab) => {
            const TabIcon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-semibold transition-colors ${
                  activeTab === tab.id
                    ? 'bg-certvoice-accent text-white'
                    : 'text-certvoice-muted hover:text-certvoice-text'
                }`}
              >
                <TabIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`text-[9px] min-w-[16px] h-4 rounded-full flex items-center justify-center ${
                      activeTab === tab.id
                        ? 'bg-white/20 text-white'
                        : 'bg-certvoice-surface-2 text-certvoice-muted'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ---- Tab Content ---- */}
        <div>{tabRenderers[activeTab]()}</div>
      </div>
    </>
  )
}
