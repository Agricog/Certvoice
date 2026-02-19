/**
 * CertVoice — EICCapture Page
 *
 * Main capture workflow for an Electrical Installation Certificate (EIC).
 * Orchestrates 5 tabs: Circuits, Design, Supply, Checklist, Sign.
 *
 * Architecture mirrors InspectionCapture (EICR) with shared components:
 *   - CircuitRecorder, BoardEditor, SupplyDetails, InspectionChecklist, TestInstrumentsForm
 * Plus EIC-specific components:
 *   - DesignForm, DeparturesList, EICDeclarationForm, inline PartPNotification
 *
 * Persistence:
 *   - IndexedDB offline-first (same as EICR)
 *   - Sync via typeData pattern (same as Minor Works)
 *   - Certificate created on API with certificateType='EIC'
 *
 * **File: src/pages/EICCapture.tsx** (create new)
 *
 * @module pages/EICCapture
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
  Trash2,
  Share2,
  Ruler,
} from 'lucide-react'
import type {
  EICCertificate,
  EICClientDetails,
  EICInstallationDetails,
  ExtentOfWork,
  DesignDetails,
  Departure,
  EICDeclarations,
  PartPNotification,
  ExistingInstallationComments,
  SchemeBody,
  SupplyCharacteristics,
  InstallationParticulars,
  DistributionBoardHeader,
  CircuitDetail,
  TestInstruments,
  InspectionItem,
  InspectionOutcome,
} from '../types/eic'
import type { EarthingType } from '../types/eicr'
import CircuitRecorder from '../components/CircuitRecorder'
import SupplyDetails from '../components/SupplyDetails'
import InspectionChecklist from '../components/InspectionChecklist'
import SyncIndicator from '../components/SyncIndicator'
import TestInstrumentsForm, { EMPTY_INSTRUMENTS } from '../components/TestInstrumentsForm'
import BoardEditor from '../components/BoardEditor'
import DesignForm, { EMPTY_DESIGN } from '../components/DesignForm'
import DeparturesList from '../components/DeparturesList'
import EICDeclarationForm, { EMPTY_DECLARATIONS } from '../components/EICDeclarationForm'
import useEngineerProfile from '../hooks/useEngineerProfile'
import { captureError } from '../utils/errorTracking'
import { trackCircuitCaptured, trackChecklistProgress } from '../utils/analytics'
import { saveCertificate as saveToLocal, getCertificate as getFromLocal } from '../services/offlineStore'
import { createCertificate } from '../services/certificateApi'
import { createSyncService } from '../services/syncService'
import { createDefaultSchedule } from '../data/bs7671Schedule'

// ============================================================
// TYPES
// ============================================================

type CaptureTab = 'circuits' | 'design' | 'supply' | 'checklist' | 'sign'
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
  { dbReference: 'DB1', dbLocation: 'New consumer unit' } as DistributionBoardHeader,
]

const EMPTY_EXTENT: ExtentOfWork = {
  workExtent: 'NEW_INSTALLATION',
  descriptionOfWork: '',
  dateCommenced: '',
  dateCompleted: '',
}

const EMPTY_PART_P: PartPNotification = {
  isNotifiable: true,
  notificationSubmitted: false,
  notificationReference: '',
  dateSubmitted: '',
  schemeBody: null,
  buildingControlBody: '',
  notes: '',
}

const EMPTY_EXISTING: ExistingInstallationComments = {
  generalCondition: '',
  defectsObserved: '',
  recommendations: '',
}

const SCHEME_BODIES: { value: SchemeBody; label: string }[] = [
  { value: 'NICEIC', label: 'NICEIC' },
  { value: 'NAPIT', label: 'NAPIT' },
  { value: 'ELECSA', label: 'ELECSA' },
  { value: 'STROMA', label: 'Stroma' },
  { value: 'CERTSURE', label: 'Certsure' },
  { value: 'OTHER', label: 'Other' },
]

// ============================================================
// COMPONENT
// ============================================================

export default function EICCapture() {
  const location = useLocation()
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken, getTokenSafe } = useApiToken()
  const { profile: engineerProfile } = useEngineerProfile()

  // --- Page state ---
  const [pageState, setPageState] = useState<PageState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  // --- Certificate state (stored as generic Record for IndexedDB compatibility) ---
  const [certData, setCertData] = useState<Record<string, unknown>>({})
  const [activeTab, setActiveTab] = useState<CaptureTab>('circuits')
  const [activeDbIndex, setActiveDbIndex] = useState(0)
  const [recorderMode, setRecorderMode] = useState<RecorderMode>(null)
  const [editingCircuitIndex, setEditingCircuitIndex] = useState<number | null>(null)
  const [editingBoardIndex, setEditingBoardIndex] = useState<number | null>(null)
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)
  const [pdfReady, setPdfReady] = useState<{ url: string; filename: string } | null>(null)

  // --- Typed accessors ---
  const certId = certData.id as string | undefined
  const reportNumber = certData.reportNumber as string | undefined
  const status = certData.status as string | undefined
  const clientDetails = (certData.clientDetails ?? { clientName: '', clientAddress: '' }) as EICClientDetails
  const installationDetails = (certData.installationDetails ?? { installationAddress: '', occupier: '', premisesType: 'DOMESTIC' }) as EICInstallationDetails
  const extentOfWork = (certData.extentOfWork ?? EMPTY_EXTENT) as ExtentOfWork
  const design = (certData.design ?? EMPTY_DESIGN) as DesignDetails
  const departures = (certData.departures ?? []) as Departure[]
  const declarations = (certData.declarations ?? EMPTY_DECLARATIONS) as EICDeclarations
  const partP = (certData.partPNotification ?? EMPTY_PART_P) as PartPNotification
  const existingInstallation = (certData.existingInstallation ?? EMPTY_EXISTING) as ExistingInstallationComments
  const supply = (certData.supplyCharacteristics ?? EMPTY_SUPPLY) as SupplyCharacteristics
  const particulars = (certData.installationParticulars ?? EMPTY_PARTICULARS) as InstallationParticulars
  const boards = (certData.distributionBoards ?? DEFAULT_BOARDS) as DistributionBoardHeader[]
  const circuits = (certData.circuits ?? []) as CircuitDetail[]
  const testInstruments = (certData.testInstruments ?? EMPTY_INSTRUMENTS) as TestInstruments
  const inspectionItems = (certData.inspectionSchedule ?? []) as InspectionItem[]
  const earthingType = supply.earthingType

  const activeBoard = boards[activeDbIndex]
  const boardCircuits = useMemo(
    () => activeBoard?.dbReference ? circuits.filter((c) => c.dbId === activeBoard.dbReference) : circuits,
    [circuits, activeBoard]
  )

  // --- Transcript toggle ---
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

  // --- Persist helper ---
  const persistCert = useCallback(
    async (data: Record<string, unknown>) => {
      const id = data.id as string
      if (!id) return
      try {
        await saveToLocal(id, data as Record<string, unknown> & { id: string }, true)
        syncServiceRef.current?.syncNow()
      } catch (err) {
        captureError(err, 'EICCapture.persistCert')
      }
    },
    []
  )

  // --- Update helper: merges field into certData, persists ---
  const updateCert = useCallback(
    (updates: Record<string, unknown>) => {
      setCertData((prev) => {
        const next = { ...prev, ...updates, updatedAt: new Date().toISOString() }
        persistCert(next)
        return next
      })
    },
    [persistCert]
  )

  // ============================================================
  // LOAD / CREATE ON MOUNT
  // ============================================================

  useEffect(() => {
    const certIdFromUrl = params.id
    const stateCert = (location.state as { certificate?: Record<string, unknown> })?.certificate

    async function loadOrCreate() {
      try {
        // Case 1: Existing ID in URL — load from IndexedDB
        if (certIdFromUrl) {
          const local = await getFromLocal(certIdFromUrl)
          if (local?.data) {
            const loaded = local.data as unknown as Record<string, unknown>
            if (!loaded.distributionBoards || !(loaded.distributionBoards as unknown[]).length) {
              loaded.distributionBoards = DEFAULT_BOARDS
            }
            setCertData(loaded)
            setPageState('ready')
            return
          }
        }

        // Case 2: New certificate from navigation state
        if (stateCert) {
          try {
            const created = await createCertificate(getToken, {
              certificateType: 'EIC',
              clientName: (stateCert.clientDetails as EICClientDetails)?.clientName ?? undefined,
              clientAddress: (stateCert.clientDetails as EICClientDetails)?.clientAddress ?? undefined,
              installationAddress: (stateCert.installationDetails as EICInstallationDetails)?.installationAddress ?? undefined,
            })

            const newCert: Record<string, unknown> = {
              ...stateCert,
              id: created.id,
              certificateType: 'EIC',
              reportNumber: created.reportNumber,
              status: created.status,
              distributionBoards: DEFAULT_BOARDS,
              circuits: [],
              departures: [],
              inspectionSchedule: [],
              createdAt: created.createdAt,
              updatedAt: created.createdAt,
            }

            setCertData(newCert)
            await saveToLocal(created.id, newCert as Record<string, unknown> & { id: string }, false)
            navigate(`/eic/${created.id}`, { replace: true })
            setPageState('ready')
            return
          } catch {
            // API failed — create locally
            const tempId = (stateCert.id as string) ?? crypto.randomUUID()
            const localCert: Record<string, unknown> = {
              ...stateCert,
              id: tempId,
              certificateType: 'EIC',
              reportNumber: `EIC-${Date.now().toString(36).toUpperCase()}`,
              status: 'DRAFT',
              distributionBoards: DEFAULT_BOARDS,
              circuits: [],
              departures: [],
              inspectionSchedule: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }

            setCertData(localCert)
            await saveToLocal(tempId, localCert as Record<string, unknown> & { id: string }, true)
            navigate(`/eic/${tempId}`, { replace: true })
            setPageState('ready')
            return
          }
        }

        navigate('/', { replace: true })
      } catch (err) {
        captureError(err, 'EICCapture.loadOrCreate')
        setLoadError('Failed to load certificate.')
        setPageState('error')
      }
    }

    loadOrCreate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Sync service lifecycle ---
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

  // --- Auto-populate inspection schedule if empty ---
  useEffect(() => {
    if (pageState === 'ready' && certId && inspectionItems.length === 0) {
      const items = createDefaultSchedule()
      setCertData((prev) => {
        if ((prev.inspectionSchedule as InspectionItem[] | undefined)?.length) return prev
        const next = { ...prev, inspectionSchedule: items, updatedAt: new Date().toISOString() }
        persistCert(next)
        return next
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState, certId])

  // ============================================================
  // VALIDATION WARNINGS
  // ============================================================

  const validationWarnings = useMemo(() => {
    const w: string[] = []
    if (!circuits.length) w.push('No circuits recorded')
    if (!supply.earthingType) w.push('Earthing type not set')
    if (supply.ze === null || supply.ze === undefined) w.push('Ze not measured')
    if (supply.ipf === null || supply.ipf === undefined) w.push('Ipf not measured')
    if (!extentOfWork.descriptionOfWork.trim()) w.push('Description of work not set')
    if (!extentOfWork.dateCompleted) w.push('Completion date not set')
    if (!design.ocpdCharacteristicsAppropriate || !design.circuitsAdequatelySized ||
        !design.disconnectionTimesAchievable || !design.spdAssessmentDone) {
      w.push('Design confirmations incomplete')
    }
    if (!declarations.designer.name.trim()) w.push('Designer not declared')
    if (!declarations.constructor.name.trim()) w.push('Constructor not declared')
    if (!declarations.inspector.name.trim()) w.push('Inspector not declared')
    const scheduleComplete = inspectionItems.filter((i) => i.outcome !== null).length
    if (inspectionItems.length > 0 && scheduleComplete < inspectionItems.length) {
      w.push(`Inspection schedule ${scheduleComplete}/${inspectionItems.length}`)
    }
    if (partP.isNotifiable && !partP.notificationSubmitted) w.push('Part P notification pending')
    return w
  }, [circuits, supply, extentOfWork, design, declarations, inspectionItems, partP])

  // ============================================================
  // HANDLERS: CIRCUITS (same pattern as EICR)
  // ============================================================

  const handleCircuitConfirmed = useCallback(
    (circuit: Partial<CircuitDetail>) => {
      try {
        setCertData((prev) => {
          const existing = [...((prev.circuits as CircuitDetail[]) ?? [])]
          if (editingCircuitIndex !== null) {
            existing[editingCircuitIndex] = { ...existing[editingCircuitIndex], ...circuit } as CircuitDetail
          } else {
            existing.push({
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
            } as CircuitDetail)
          }
          const next = { ...prev, circuits: existing, updatedAt: new Date().toISOString() }
          persistCert(next)
          return next
        })
        trackCircuitCaptured(circuit.circuitType ?? 'UNKNOWN', recorderMode ?? 'manual')
        setRecorderMode(null)
        setEditingCircuitIndex(null)
      } catch (error) {
        captureError(error, 'EICCapture.handleCircuitConfirmed')
      }
    },
    [editingCircuitIndex, activeBoard, persistCert, recorderMode]
  )

  const handleDeleteCircuit = useCallback((globalIdx: number) => {
    setCertData((prev) => {
      const existing = [...((prev.circuits as CircuitDetail[]) ?? [])]
      existing.splice(globalIdx, 1)
      const next = { ...prev, circuits: existing, updatedAt: new Date().toISOString() }
      persistCert(next)
      return next
    })
  }, [persistCert])

  // ============================================================
  // HANDLERS: BOARDS
  // ============================================================

  const handleAddBoard = useCallback(() => {
    setCertData((prev) => {
      const existing = [...((prev.distributionBoards as DistributionBoardHeader[]) ?? [])]
      existing.push({ dbReference: `DB${existing.length + 1}`, dbLocation: '' } as DistributionBoardHeader)
      const next = { ...prev, distributionBoards: existing }
      persistCert(next)
      return next
    })
  }, [persistCert])

  const handleBoardUpdate = useCallback((updated: DistributionBoardHeader) => {
    setCertData((prev) => {
      const existing = [...((prev.distributionBoards as DistributionBoardHeader[]) ?? [])]
      if (editingBoardIndex !== null && editingBoardIndex < existing.length) {
        const oldRef = existing[editingBoardIndex].dbReference
        existing[editingBoardIndex] = updated
        if (oldRef !== updated.dbReference) {
          const updatedCircuits = ((prev.circuits as CircuitDetail[]) ?? []).map((c) =>
            c.dbId === oldRef ? { ...c, dbId: updated.dbReference } : c
          )
          const next = { ...prev, distributionBoards: existing, circuits: updatedCircuits, updatedAt: new Date().toISOString() }
          persistCert(next)
          return next
        }
      }
      const next = { ...prev, distributionBoards: existing, updatedAt: new Date().toISOString() }
      persistCert(next)
      return next
    })
    setEditingBoardIndex(null)
  }, [editingBoardIndex, persistCert])

  // ============================================================
  // HANDLERS: SUPPLY
  // ============================================================

  const handleSupplyChange = useCallback((updated: SupplyCharacteristics) => {
    updateCert({ supplyCharacteristics: updated })
  }, [updateCert])

  const handleParticularsChange = useCallback((updated: InstallationParticulars) => {
    updateCert({ installationParticulars: updated })
  }, [updateCert])

  // ============================================================
  // HANDLERS: CHECKLIST
  // ============================================================

  const handleItemChange = useCallback(
    (itemId: string, outcome: InspectionOutcome | null, notes: string) => {
      setCertData((prev) => {
        const items = [...((prev.inspectionSchedule as InspectionItem[]) ?? [])]
        const idx = items.findIndex((i) => i.id === itemId)
        if (idx >= 0) items[idx] = { ...items[idx], outcome, notes } as InspectionItem
        const completed = items.filter((i) => i.outcome !== null).length
        trackChecklistProgress(completed, items.length)
        const next = { ...prev, inspectionSchedule: items, updatedAt: new Date().toISOString() }
        persistCert(next)
        return next
      })
    },
    [persistCert]
  )

  const handleBulkPass = useCallback((sectionNumber: number) => {
    setCertData((prev) => {
      const items = [...((prev.inspectionSchedule as InspectionItem[]) ?? [])]
      const updated = items.map((item) =>
        item.section === sectionNumber && !item.outcome
          ? { ...item, outcome: 'PASS' as InspectionOutcome }
          : item
      )
      const next = { ...prev, inspectionSchedule: updated, updatedAt: new Date().toISOString() }
      persistCert(next)
      return next
    })
  }, [persistCert])

  // ============================================================
  // HANDLERS: EIC-SPECIFIC SECTIONS
  // ============================================================

  const handleDesignChange = useCallback((updated: DesignDetails) => {
    updateCert({ design: updated })
  }, [updateCert])

  const handleDeparturesChange = useCallback((updated: Departure[]) => {
    updateCert({ departures: updated })
  }, [updateCert])

  const handleDeclarationsChange = useCallback((updated: EICDeclarations) => {
    updateCert({ declarations: updated })
  }, [updateCert])

  const handleInstrumentsChange = useCallback((updated: TestInstruments) => {
    updateCert({ testInstruments: updated })
  }, [updateCert])

  const handlePartPChange = useCallback((field: keyof PartPNotification, value: unknown) => {
    updateCert({ partPNotification: { ...partP, [field]: value } })
  }, [updateCert, partP])

  const handleExtentChange = useCallback((field: keyof ExtentOfWork, value: unknown) => {
    updateCert({ extentOfWork: { ...extentOfWork, [field]: value } })
  }, [updateCert, extentOfWork])

  const handleExistingChange = useCallback((field: keyof ExistingInstallationComments, value: string) => {
    updateCert({ existingInstallation: { ...existingInstallation, [field]: value } })
  }, [updateCert, existingInstallation])

  // ============================================================
  // HANDLERS: PDF EXPORT
  // ============================================================

  const handleExportPdf = useCallback(async () => {
    // TODO: Wire to EIC PDF generator (eicPdf.ts)
    alert('EIC PDF generation coming soon')
  }, [])

  const handleSharePdf = useCallback(async () => {
    if (!pdfReady) return
    try {
      const response = await fetch(pdfReady.url)
      const blob = await response.blob()
      const file = new File([blob], pdfReady.filename, { type: 'application/pdf' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `EIC — ${reportNumber ?? ''}`,
          text: `Electrical Installation Certificate for ${installationDetails.installationAddress ?? 'property'}`,
        })
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') captureError(err, 'EICCapture.handleSharePdf')
    }
  }, [pdfReady, reportNumber, installationDetails.installationAddress])

  const handleSave = useCallback(() => {
    persistCert(certData)
  }, [certData, persistCert])

  // ============================================================
  // TAB CONFIG
  // ============================================================

  const TABS: { id: CaptureTab; label: string; icon: typeof Zap; count?: number }[] = [
    { id: 'circuits', label: 'Circuits', icon: CircuitBoard, count: circuits.length },
    { id: 'design', label: 'Design', icon: Ruler, count: departures.length || undefined },
    { id: 'supply', label: 'Supply', icon: Settings2 },
    { id: 'checklist', label: 'Checklist', icon: ClipboardList },
    { id: 'sign', label: 'Sign', icon: FileSignature },
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
      {activeBoard && editingBoardIndex === null && (
        <button
          type="button"
          onClick={() => setEditingBoardIndex(activeDbIndex)}
          className="w-full text-left text-xs text-certvoice-muted hover:text-certvoice-accent transition-colors"
        >
          {activeBoard.dbLocation ? `Location: ${activeBoard.dbLocation}` : 'No location set'} ·{' '}
          {boardCircuits.length} circuit{boardCircuits.length !== 1 ? 's' : ''}
          {activeBoard.zsAtDb != null ? ` · Zs: ${activeBoard.zsAtDb}Ω` : ''}
          {activeBoard.ipfAtDb != null ? ` · Ipf: ${activeBoard.ipfAtDb}kA` : ''}
          <span className="text-certvoice-accent/60 ml-1">Edit</span>
        </button>
      )}

      {activeBoard && editingBoardIndex === activeDbIndex && (
        <BoardEditor
          board={activeBoard}
          onSave={handleBoardUpdate}
          onCancel={() => setEditingBoardIndex(null)}
        />
      )}

      {/* Circuit list */}
      {boardCircuits.length === 0 ? (
        <div className="cv-panel text-center py-8">
          <CircuitBoard className="w-6 h-6 text-certvoice-muted/40 mx-auto mb-2" />
          <p className="text-xs text-certvoice-muted">No circuits captured yet</p>
        </div>
      ) : (
        boardCircuits.map((circuit, idx) => {
          const globalIdx = circuits.findIndex((c) => c.id === circuit.id)
          return (
            <div key={circuit.id ?? `${circuit.circuitNumber}-${idx}`} className="space-y-1">
              <button
                type="button"
                onClick={() => { setEditingCircuitIndex(globalIdx); setRecorderMode('manual') }}
                className="cv-panel w-full text-left p-3 hover:border-certvoice-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-certvoice-text">Cct {circuit.circuitNumber}</span>
                    <span className="text-xs text-certvoice-muted ml-2">{circuit.circuitDescription ?? ''}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete circuit ${circuit.circuitNumber}?`)) handleDeleteCircuit(globalIdx) }}
                    className="w-6 h-6 rounded flex items-center justify-center text-certvoice-muted hover:text-certvoice-red transition-colors ml-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {circuit.zs !== null && circuit.zs !== undefined && (
                  <div className="text-[10px] text-certvoice-muted mt-1">
                    Zs: {circuit.zs}Ω{circuit.r1r2 ? ` · R1+R2: ${circuit.r1r2}Ω` : ''}
                    {circuit.rcdDisconnectionTime ? ` · RCD: ${circuit.rcdDisconnectionTime}ms` : ''}
                  </div>
                )}
              </button>
              {circuit.voiceTranscript && (
                <button type="button" onClick={() => toggleTranscript(circuit.id)}
                  className="flex items-center gap-1 px-3 py-1 text-[10px] text-certvoice-muted hover:text-certvoice-accent transition-colors">
                  <Mic className="w-2.5 h-2.5" />
                  {expandedTranscripts.has(circuit.id) ? 'Hide' : 'View'} transcript
                </button>
              )}
              {expandedTranscripts.has(circuit.id) && circuit.voiceTranscript && (
                <div className="bg-certvoice-surface-2 border border-certvoice-border rounded-lg px-3 py-2">
                  <p className="text-[10px] text-certvoice-muted font-mono leading-relaxed whitespace-pre-wrap">{circuit.voiceTranscript}</p>
                </div>
              )}
            </div>
          )
        })
      )}

      {/* Add circuit buttons */}
      <div className="flex gap-3">
        <button type="button" onClick={() => { setEditingCircuitIndex(null); setRecorderMode('voice') }}
          className="cv-btn-primary flex-1 flex items-center justify-center gap-2">
          <Mic className="w-4 h-4" /> Record Circuit
        </button>
        <button type="button" onClick={() => { setEditingCircuitIndex(null); setRecorderMode('manual') }}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold
                     bg-certvoice-surface-2 border border-certvoice-border text-certvoice-text
                     hover:border-certvoice-accent hover:text-certvoice-accent transition-colors">
          <Pencil className="w-4 h-4" /> Manual Entry
        </button>
      </div>

      {recorderMode && (
        <CircuitRecorder
          mode={recorderMode}
          locationContext={activeBoard?.dbLocation ?? ''}
          dbContext={activeBoard?.dbReference ?? 'DB1'}
          existingCircuits={boardCircuits.map((c) => c.circuitNumber ?? '')}
          earthingType={earthingType}
          editingCircuit={editingCircuitIndex !== null ? (circuits[editingCircuitIndex] ?? null) : null}
          onCircuitConfirmed={handleCircuitConfirmed}
          onCancel={() => { setRecorderMode(null); setEditingCircuitIndex(null) }}
        />
      )}
    </div>
  )

  // ============================================================
  // RENDER: DESIGN TAB
  // ============================================================

  const renderDesignTab = () => (
    <div className="space-y-4">
      {/* Extent of Work */}
      <div className="cv-panel p-4 space-y-3">
        <h3 className="text-sm font-bold text-certvoice-text flex items-center gap-2">
          <Ruler className="w-4 h-4 text-certvoice-accent" />
          Extent of Work — Section C
        </h3>

        <div>
          <label className="block text-xs font-semibold text-certvoice-text mb-1">Type of Work</label>
          <div className="flex flex-wrap gap-2">
            {([
              ['NEW_INSTALLATION', 'New Installation'],
              ['ADDITION', 'Addition'],
              ['ALTERATION', 'Alteration'],
              ['OTHER', 'Other'],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => handleExtentChange('workExtent', val)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  extentOfWork.workExtent === val
                    ? 'bg-certvoice-accent/15 border-certvoice-accent text-certvoice-accent'
                    : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-certvoice-text mb-1">
            Description of Work <span className="text-certvoice-red">*</span>
          </label>
          <textarea
            value={extentOfWork.descriptionOfWork}
            onChange={(e) => handleExtentChange('descriptionOfWork', e.target.value)}
            placeholder="e.g. Full rewire of 3-bed semi-detached dwelling including new consumer unit, 12 final circuits..."
            rows={3}
            className="cv-input resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-certvoice-text mb-1">Date Commenced</label>
            <input
              type="date"
              value={extentOfWork.dateCommenced}
              onChange={(e) => handleExtentChange('dateCommenced', e.target.value)}
              className="cv-input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-certvoice-text mb-1">Date Completed</label>
            <input
              type="date"
              value={extentOfWork.dateCompleted}
              onChange={(e) => handleExtentChange('dateCompleted', e.target.value)}
              className="cv-input"
            />
          </div>
        </div>
      </div>

      {/* Design details */}
      <DesignForm
        design={design}
        onDesignChange={handleDesignChange}
        disabled={status === 'ISSUED'}
      />

      {/* Comments on existing installation */}
      <div className="cv-panel p-4 space-y-3">
        <h3 className="text-sm font-bold text-certvoice-text">
          Comments on Existing Installation — Section H
        </h3>
        <p className="text-[10px] text-certvoice-muted">
          Condition of existing installation where new work connects
        </p>
        <div>
          <label className="block text-xs font-semibold text-certvoice-text mb-1">General Condition</label>
          <textarea
            value={existingInstallation.generalCondition}
            onChange={(e) => handleExistingChange('generalCondition', e.target.value)}
            placeholder="e.g. Existing wiring in satisfactory condition..."
            rows={2}
            className="cv-input resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-certvoice-text mb-1">Defects Observed</label>
          <textarea
            value={existingInstallation.defectsObserved}
            onChange={(e) => handleExistingChange('defectsObserved', e.target.value)}
            placeholder="Any defects in existing installation (or 'None observed')"
            rows={2}
            className="cv-input resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-certvoice-text mb-1">Recommendations</label>
          <textarea
            value={existingInstallation.recommendations}
            onChange={(e) => handleExistingChange('recommendations', e.target.value)}
            placeholder="Recommendations for existing installation"
            rows={2}
            className="cv-input resize-none"
          />
        </div>
      </div>

      {/* Departures */}
      <DeparturesList
        departures={departures}
        onDeparturesChange={handleDeparturesChange}
        disabled={status === 'ISSUED'}
      />
    </div>
  )

  // ============================================================
  // RENDER: SUPPLY TAB (shared component)
  // ============================================================

  const renderSupplyTab = () => (
    <SupplyDetails
      supply={supply}
      particulars={particulars}
      onSupplyChange={handleSupplyChange}
      onParticularsChange={handleParticularsChange}
    />
  )

  // ============================================================
  // RENDER: CHECKLIST TAB (shared component)
  // ============================================================

  const renderChecklistTab = () => (
    <InspectionChecklist
      items={inspectionItems}
      onItemChange={handleItemChange}
      onBulkPass={handleBulkPass}
    />
  )

  // ============================================================
  // RENDER: SIGN TAB
  // ============================================================

  const renderSignTab = () => (
    <div className="space-y-4">
      {/* Test instruments */}
      <TestInstrumentsForm
        instruments={testInstruments}
        onInstrumentsChange={handleInstrumentsChange}
        engineerProfile={engineerProfile}
        disabled={status === 'ISSUED'}
      />

      {/* Part P Notification */}
      <div className="cv-panel p-4 space-y-3">
        <h3 className="text-sm font-bold text-certvoice-text flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-certvoice-accent" />
          Part P Notification — Section G
        </h3>

        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-certvoice-text">Work is notifiable under Part P</span>
          <button
            type="button"
            onClick={() => handlePartPChange('isNotifiable', !partP.isNotifiable)}
            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
              partP.isNotifiable
                ? 'bg-certvoice-accent/15 border-certvoice-accent text-certvoice-accent'
                : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted'
            }`}
          >
            {partP.isNotifiable && <Zap className="w-4 h-4" />}
          </button>
        </div>

        {partP.isNotifiable && (
          <>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-certvoice-text">Notification submitted</span>
              <button
                type="button"
                onClick={() => handlePartPChange('notificationSubmitted', !partP.notificationSubmitted)}
                className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
                  partP.notificationSubmitted
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                    : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted'
                }`}
              >
                {partP.notificationSubmitted && <Zap className="w-4 h-4" />}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-certvoice-text mb-1">Scheme Body</label>
                <select
                  value={partP.schemeBody ?? ''}
                  onChange={(e) => handlePartPChange('schemeBody', e.target.value || null)}
                  className="cv-input"
                >
                  <option value="">Select...</option>
                  {SCHEME_BODIES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-certvoice-text mb-1">Reference No.</label>
                <input
                  type="text"
                  value={partP.notificationReference}
                  onChange={(e) => handlePartPChange('notificationReference', e.target.value)}
                  placeholder="Notification ref"
                  className="cv-input"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-certvoice-text mb-1">Date Submitted</label>
              <input
                type="date"
                value={partP.dateSubmitted}
                onChange={(e) => handlePartPChange('dateSubmitted', e.target.value)}
                className="cv-input"
              />
            </div>

            {!partP.notificationSubmitted && (
              <div className="flex items-center gap-1.5 text-[10px] text-certvoice-amber">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                Part P notification must be submitted for notifiable work
              </div>
            )}
          </>
        )}

        {!partP.isNotifiable && (
          <div>
            <label className="block text-xs font-semibold text-certvoice-text mb-1">
              Notes <span className="text-certvoice-muted font-normal">(why not notifiable)</span>
            </label>
            <textarea
              value={partP.notes}
              onChange={(e) => handlePartPChange('notes', e.target.value)}
              placeholder="e.g. Like-for-like replacement of consumer unit (exempt work)"
              rows={2}
              className="cv-input resize-none"
            />
          </div>
        )}
      </div>

      {/* Three declarations */}
      <EICDeclarationForm
        declarations={declarations}
        onDeclarationsChange={handleDeclarationsChange}
        engineerProfile={engineerProfile}
        disabled={status === 'ISSUED'}
      />
    </div>
  )

  // ============================================================
  // RENDER: MAIN
  // ============================================================

  const tabRenderers: Record<CaptureTab, () => JSX.Element> = {
    circuits: renderCircuitsTab,
    design: renderDesignTab,
    supply: renderSupplyTab,
    checklist: renderChecklistTab,
    sign: renderSignTab,
  }

  const address = installationDetails.installationAddress || 'New EIC'

  return (
    <>
      <Helmet>
        <title>EIC | CertVoice</title>
        <meta name="description" content="Electrical Installation Certificate" />
      </Helmet>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Header */}
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
              EIC — {address}
            </h1>
            <p className="text-[10px] text-certvoice-muted">
              {reportNumber ?? ''} · {clientDetails.clientName ?? ''}
            </p>
          </div>
          {syncReady && syncServiceRef.current && (
            <SyncIndicator
              onStatusChange={syncServiceRef.current.onStatusChange}
              onSyncNow={() => syncServiceRef.current?.syncNow()}
            />
          )}
          {pdfReady ? (
            <>
              <a href={pdfReady.url} download={pdfReady.filename}
                className="w-8 h-8 rounded-lg border border-certvoice-green flex items-center justify-center
                           text-certvoice-green hover:bg-certvoice-green/10 transition-colors animate-pulse">
                <Download className="w-4 h-4" />
              </a>
              <button type="button" onClick={handleSharePdf}
                className="w-8 h-8 rounded-lg border border-certvoice-accent flex items-center justify-center
                           text-certvoice-accent hover:bg-certvoice-accent/10 transition-colors">
                <Share2 className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button type="button" onClick={handleExportPdf} disabled={isExporting}
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-accent hover:border-certvoice-accent transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed">
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
          )}
          <button type="button" onClick={handleSave}
            className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                       text-certvoice-muted hover:text-certvoice-green hover:border-certvoice-green transition-colors">
            <Save className="w-4 h-4" />
          </button>
        </div>

        {/* Validation warnings */}
        {validationWarnings.length > 0 && (
          <div className="cv-panel border-certvoice-amber/30 bg-certvoice-amber/5 p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-certvoice-amber">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Missing information ({validationWarnings.length})
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {validationWarnings.map((w) => (
                <span key={w} className="text-[10px] bg-certvoice-amber/10 text-certvoice-amber px-2 py-0.5 rounded">{w}</span>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
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
                  <span className={`text-[9px] min-w-[16px] h-4 rounded-full flex items-center justify-center ${
                    activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-certvoice-surface-2 text-certvoice-muted'
                  }`}>{tab.count}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        <div>{tabRenderers[activeTab]()}</div>
      </div>
    </>
  )
}
