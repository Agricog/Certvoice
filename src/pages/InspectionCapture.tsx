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
  Trash2,
  Share2,
  Camera,
  FileOutput,
} from 'lucide-react'
import type {
  EICRCertificate,
  CircuitDetail,
  Observation,
  Declaration,
  TestInstruments,
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
import TestInstrumentsForm, { EMPTY_INSTRUMENTS } from '../components/TestInstrumentsForm'
import BoardEditor from '../components/BoardEditor'
import BoardScanCapture from '../components/BoardScanCapture'
import BoardScanReview from '../components/BoardScanReview'
import useEngineerProfile from '../hooks/useEngineerProfile'
import type { BoardScanResult, ScannedCircuit } from '../hooks/useBoardScan'
import { captureError } from '../utils/errorTracking'
import { trackCircuitCaptured, trackObservationCaptured, trackChecklistProgress } from '../utils/analytics'
import { saveCertificate as saveToLocal, getCertificate as getFromLocal } from '../services/offlineStore'
import { getCertificate as getFromApi, createCertificate } from '../services/certificateApi'
import { createSyncService } from '../services/syncService'
import { generateEICRBlobUrl } from '../services/pdfGenerator'
import { createDefaultSchedule } from '../data/bs7671Schedule'

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
  const [editingBoardIndex, setEditingBoardIndex] = useState<number | null>(null)
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)
  const [pdfReady, setPdfReady] = useState<{ url: string; filename: string } | null>(null)

  // --- Board scan state ---
  const [showBoardScan, setShowBoardScan] = useState(false)
  const [boardScanResult, setBoardScanResult] = useState<BoardScanResult | null>(null)

  // --- PDF export ---
  const handleExportPdf = useCallback(async () => {
    if (pdfReady) {
      URL.revokeObjectURL(pdfReady.url)
      setPdfReady(null)
    }
    setIsExporting(true)
    try {
      const result = await generateEICRBlobUrl(certificate as EICRCertificate)
      setPdfReady(result)
   } catch (err) {
      alert('PDF ERROR: ' + (err instanceof Error ? err.message : String(err)))
      captureError(err, 'InspectionCapture.handleExportPdf')
    } finally {
      setIsExporting(false)
    }
  }, [certificate, pdfReady])

  // --- Share PDF (Web Share API) ---
  const handleSharePdf = useCallback(async () => {
    if (!pdfReady) return
    try {
      const response = await fetch(pdfReady.url)
      const blob = await response.blob()
      const file = new File([blob], pdfReady.filename, { type: 'application/pdf' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `EICR Report — ${certificate.reportNumber ?? ''}`,
          text: `EICR inspection report for ${certificate.installationDetails?.installationAddress ?? 'property'}`,
        })
      } else {
        // Fallback: copy download link (mobile browsers that don't support file sharing)
        const link = document.createElement('a')
        link.href = `mailto:?subject=EICR Report ${certificate.reportNumber ?? ''}&body=Please find the EICR report attached.`
        link.click()
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        captureError(err, 'InspectionCapture.handleSharePdf')
      }
    }
  }, [pdfReady, certificate.reportNumber, certificate.installationDetails?.installationAddress])

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

  // ============================================================
  // DERIVED STATE
  // ============================================================

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

  // Auto-set overall assessment based on observations
  useEffect(() => {
    const newAssessment = hasUnsatisfactory ? 'UNSATISFACTORY' : 'SATISFACTORY'
    const currentAssessment = certificate.summaryOfCondition?.overallAssessment
    if (observations.length > 0 && currentAssessment !== newAssessment) {
      setCertificate((prev) => {
        const cert = {
          ...prev,
          summaryOfCondition: {
            generalCondition: prev.summaryOfCondition?.generalCondition ?? '',
            overallAssessment: newAssessment as 'SATISFACTORY' | 'UNSATISFACTORY',
          },
          updatedAt: new Date().toISOString(),
        }
        persistCertificate(cert)
        return cert
      })
    }
  }, [hasUnsatisfactory, observations.length, certificate.summaryOfCondition?.overallAssessment, persistCertificate])

  // Auto-populate BS 7671 inspection schedule if empty
  useEffect(() => {
    if (pageState === 'ready' && certificate.id && (!certificate.inspectionSchedule || certificate.inspectionSchedule.length === 0)) {
      const items = createDefaultSchedule()
      setCertificate((prev) => {
        if (prev.inspectionSchedule && prev.inspectionSchedule.length > 0) return prev
        const cert = { ...prev, inspectionSchedule: items, updatedAt: new Date().toISOString() }
        persistCertificate(cert)
        return cert
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState, certificate.id])

  // --- Validation warnings (must be after derived state) ---
  const validationWarnings = useMemo(() => {
    const w: string[] = []
    if (!circuits.length) w.push('No circuits recorded')
    if (!supply.earthingType) w.push('Earthing type not set')
    if (supply.ze === null || supply.ze === undefined) w.push('Ze not measured')
    if (supply.ipf === null || supply.ipf === undefined) w.push('Ipf not measured')
    if (!supply.supplyPolarityConfirmed) w.push('Supply polarity not confirmed')
    const scheduleComplete = inspectionItems.filter((i) => i.outcome !== null).length
    if (inspectionItems.length > 0 && scheduleComplete === 0) w.push('No inspection items completed')
    else if (inspectionItems.length > 0 && scheduleComplete < inspectionItems.length) {
      w.push(`Inspection schedule ${scheduleComplete}/${inspectionItems.length} complete`)
    }
    const decl = certificate.declaration
    if (!decl?.inspectorName) w.push('Inspector name not set')
    if (!decl?.dateInspected) w.push('Inspection date not set')
    return w
  }, [circuits.length, supply, inspectionItems, certificate.declaration])

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

  const handleDeleteCircuit = useCallback((globalIdx: number) => {
    setCertificate((prev) => {
      const existing = [...(prev.circuits ?? [])]
      existing.splice(globalIdx, 1)
      const cert = { ...prev, circuits: existing, updatedAt: new Date().toISOString() }
      persistCertificate(cert)
      return cert
    })
  }, [persistCertificate])

  // ============================================================
  // HANDLERS: BOARD SCAN
  // ============================================================

  const handleBoardScanComplete = useCallback((result: BoardScanResult) => {
    setBoardScanResult(result)
  }, [])

  const handleBoardScanConfirmed = useCallback(
    (scannedCircuits: ScannedCircuit[]) => {
      try {
        setCertificate((prev) => {
          const existing = [...(prev.circuits ?? [])]
          const dbRef = activeBoard?.dbReference ?? 'DB1'

          const newCircuits: CircuitDetail[] = scannedCircuits.map((sc) => ({
            id: crypto.randomUUID(),
            dbId: dbRef,
            circuitNumber: sc.circuitNumber,
            circuitDescription: sc.circuitDescription,
            wiringType: (sc as any).cableSize?.includes('T&E') ? 'A' : (sc as any).cableSize?.includes('SWA') ? 'F' : null,
            referenceMethod: null,
            numberOfPoints: null,
            liveConductorCsa: (sc as any).cableSize ? parseFloat((sc as any).cableSize) || null : null,
            cpcCsa: null,
            maxDisconnectTime: null,
            ocpdBsEn: sc.ocpdType ? 'BS 60898' : '',
            ocpdType: (sc.ocpdType as CircuitDetail['ocpdType']) ?? null,
            ocpdRating: sc.ocpdRating,
            maxPermittedZs: null,
            breakingCapacity: null,
            rcdBsEn: sc.rcdType ? 'BS 61008' : '',
            rcdType: (sc.rcdType as CircuitDetail['rcdType']) ?? null,
            rcdRating: sc.rcdRating,
            r1: null,
            rn: null,
            r2: null,
            r1r2: null,
            r1r2OrR2: null,
            r2Standalone: null,
            irTestVoltage: null,
            irLiveLive: null,
            irLiveEarth: null,
            zs: null,
            polarity: 'NA' as const,
            rcdDisconnectionTime: null,
            rcdTestButton: 'NA' as const,
            afddTestButton: 'NA' as const,
            remarks: '',
            circuitType: null,
            status: 'INCOMPLETE' as const,
            validationWarnings: [],
          }))

          const allCircuits = [...existing, ...newCircuits]
          const cert = { ...prev, circuits: allCircuits, updatedAt: new Date().toISOString() }
          persistCertificate(cert)
          return cert
        })

        // Track each scanned circuit
        scannedCircuits.forEach(() => {
          trackCircuitCaptured('UNKNOWN', 'manual')
        })

        // Reset scan state
        setShowBoardScan(false)
        setBoardScanResult(null)
      } catch (error) {
        captureError(error, 'InspectionCapture.handleBoardScanConfirmed')
      }
    },
    [activeBoard, persistCertificate]
  )

  const handleBoardScanCancel = useCallback(() => {
    setShowBoardScan(false)
    setBoardScanResult(null)
  }, [])

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

  const handleDeleteObservation = useCallback((idx: number) => {
    setCertificate((prev) => {
      const existing = [...(prev.observations ?? [])]
      existing.splice(idx, 1)
      // Re-number remaining observations
      const renumbered = existing.map((o, i) => ({ ...o, itemNumber: i + 1 }))
      const cert = { ...prev, observations: renumbered, updatedAt: new Date().toISOString() }
      persistCertificate(cert)
      return cert
    })
  }, [persistCertificate])

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
  // HANDLERS: TEST INSTRUMENTS
  // ============================================================

  const testInstruments = certificate.testInstruments ?? EMPTY_INSTRUMENTS

  const handleInstrumentsChange = useCallback((updated: TestInstruments) => {
    setCertificate((prev) => {
      const cert = { ...prev, testInstruments: updated, updatedAt: new Date().toISOString() }
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

  const handleBoardUpdate = useCallback((updated: DistributionBoardHeader) => {
    setCertificate((prev) => {
      const existing = [...(prev.distributionBoards ?? [])]
      if (editingBoardIndex !== null && editingBoardIndex < existing.length) {
        const board = existing[editingBoardIndex]
        if (!board) return prev
        const oldRef = board.dbReference
        existing[editingBoardIndex] = updated

        // If dbReference changed, update all circuits and observations referencing the old ref
        if (oldRef !== updated.dbReference) {
          const updatedCircuits = (prev.circuits ?? []).map((c) =>
            c.dbId === oldRef ? { ...c, dbId: updated.dbReference } : c
          )
          const updatedObs = (prev.observations ?? []).map((o) =>
            o.dbReference === oldRef ? { ...o, dbReference: updated.dbReference } : o
          )
          const cert = {
            ...prev,
            distributionBoards: existing,
            circuits: updatedCircuits,
            observations: updatedObs,
            updatedAt: new Date().toISOString(),
          }
          persistCertificate(cert)
          return cert
        }
      }
      const cert = { ...prev, distributionBoards: existing, updatedAt: new Date().toISOString() }
      persistCertificate(cert)
      return cert
    })
    setEditingBoardIndex(null)
  }, [editingBoardIndex, persistCertificate])

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

      {/* Board info (tap to edit) */}
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

      {/* Board editor (inline) */}
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
          <p className="text-[10px] text-certvoice-muted/60 mt-1">
            Record by voice, type manually, or scan the board
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Delete circuit ${circuit.circuitNumber}?`)) handleDeleteCircuit(globalIdx)
                    }}
                    className="w-6 h-6 rounded flex items-center justify-center text-certvoice-muted hover:text-certvoice-red transition-colors ml-1"
                    title="Delete circuit"
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

      {/* Add circuit buttons — voice + manual + scan */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setEditingCircuitIndex(null)
            setRecorderMode('voice')
          }}
          className="cv-btn-primary flex-1 flex items-center justify-center gap-2"
        >
          <Mic className="w-4 h-4" />
          Record
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
          Manual
        </button>
        <button
          type="button"
          onClick={() => {
            setRecorderMode(null)
            setShowBoardScan(true)
            setBoardScanResult(null)
          }}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold
                     bg-certvoice-surface-2 border border-certvoice-border text-certvoice-text
                     hover:border-certvoice-accent hover:text-certvoice-accent transition-colors"
        >
          <Camera className="w-4 h-4" />
          Scan Board
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
          editingCircuit={editingCircuitIndex !== null ? (circuits[editingCircuitIndex] ?? null) : null}
          onCircuitConfirmed={handleCircuitConfirmed}
          onCancel={() => {
            setRecorderMode(null)
            setEditingCircuitIndex(null)
          }}
        />
      )}

      {/* Board Scan — capture phase */}
      {showBoardScan && !boardScanResult && (
        <BoardScanCapture
          getToken={getToken}
          onScanComplete={handleBoardScanComplete}
          onCancel={handleBoardScanCancel}
        />
      )}

      {/* Board Scan — review phase */}
      {showBoardScan && boardScanResult && (
        <BoardScanReview
          boardReference={boardScanResult.boardReference || activeBoard?.dbReference || 'DB1'}
          circuits={boardScanResult.circuits}
          onConfirm={handleBoardScanConfirmed}
          onCancel={handleBoardScanCancel}
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
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Delete observation ${obs.classificationCode} #${obs.itemNumber}?`)) handleDeleteObservation(idx)
                  }}
                  className="w-6 h-6 rounded flex items-center justify-center text-certvoice-muted hover:text-certvoice-red transition-colors shrink-0"
                  title="Delete observation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
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
          getToken={getToken}
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
  // RENDER: DECLARATION TAB (Test Instruments + Declaration)
  // ============================================================

  const renderDeclarationTab = () => (
    <div className="space-y-4">
      <TestInstrumentsForm
        instruments={testInstruments}
        onInstrumentsChange={handleInstrumentsChange}
        engineerProfile={engineerProfile}
        disabled={certificate.status === 'ISSUED'}
      />
      <DeclarationForm
        certificateId={certificate.id ?? ''}
        declaration={declaration}
        onDeclarationChange={handleDeclarationChange}
        getToken={getToken}
        engineerProfile={engineerProfile}
        disabled={certificate.status === 'ISSUED'}
      />
    </div>
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
            <>
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
              <button
                type="button"
                onClick={handleSharePdf}
                className="w-8 h-8 rounded-lg border border-certvoice-accent flex items-center justify-center
                           text-certvoice-accent hover:bg-certvoice-accent/10 transition-colors"
                title="Share PDF"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </>
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
          {certificate.id && (
            <Link
              to={`/export/niceic/eicr/${certificate.id}`}
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-accent hover:border-certvoice-accent transition-colors"
              title="Export to NICEIC"
            >
              <FileOutput className="w-4 h-4" />
            </Link>
          )}
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

        {/* ---- Validation Warnings ---- */}
        {validationWarnings.length > 0 && (
          <div className="cv-panel border-certvoice-amber/30 bg-certvoice-amber/5 p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-certvoice-amber">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Missing information ({validationWarnings.length})
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {validationWarnings.map((w) => (
                <span key={w} className="text-[10px] bg-certvoice-amber/10 text-certvoice-amber px-2 py-0.5 rounded">
                  {w}
                </span>
              ))}
            </div>
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
