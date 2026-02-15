/**
 * CertVoice — InspectionCapture Page
 *
 * Main capture workflow for an EICR inspection.
 * Orchestrates 4 tabs: Circuits, Observations, Supply, Checklist.
 *
 * Receives a Partial<EICRCertificate> from NewInspection via
 * navigation state (location.state.certificate).
 *
 * Component prop interfaces (from actual deployed files):
 *   CircuitRecorder:     locationContext, dbContext, existingCircuits, earthingType, onCircuitConfirmed, onCancel
 *   ObservationRecorder: locationContext, dbContext, nextItemNumber, earthingType, existingCircuits, onObservationConfirmed, onCancel
 *   SupplyDetails:       supply, particulars, onSupplyChange, onParticularsChange
 *   InspectionChecklist: items, onItemChange, onBulkPass
 *
 * @module pages/InspectionCapture
 */

import { useState, useCallback, useMemo } from 'react'
import { useLocation, Link } from 'react-router-dom'
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
} from 'lucide-react'
import type {
  EICRCertificate,
  CircuitDetail,
  Observation,
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
import { captureError } from '../utils/errorTracking'
import { trackCircuitCaptured, trackObservationCaptured, trackChecklistProgress } from '../utils/analytics'

// ============================================================
// TYPES
// ============================================================

type CaptureTab = 'circuits' | 'observations' | 'supply' | 'checklist'

// ============================================================
// DEFAULT EMPTY SUPPLY / PARTICULARS
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

// ============================================================
// COMPONENT
// ============================================================

export default function InspectionCapture() {
  const location = useLocation()

  // --- Certificate state ---
  const initialCert = (location.state as { certificate?: Partial<EICRCertificate> })
    ?.certificate ?? {
    id: crypto.randomUUID(),
    reportNumber: `CV-${Date.now().toString(36).toUpperCase()}`,
    status: 'DRAFT' as const,
    observations: [],
    circuits: [],
    distributionBoards: [
      {
        dbReference: 'DB1',
        dbLocation: 'Main consumer unit',
      } as DistributionBoardHeader,
    ],
    inspectionSchedule: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const [certificate, setCertificate] = useState<Partial<EICRCertificate>>(initialCert)
  const [activeTab, setActiveTab] = useState<CaptureTab>('circuits')
  const [activeDbIndex, setActiveDbIndex] = useState(0)
  const [showCircuitRecorder, setShowCircuitRecorder] = useState(false)
  const [showObservationRecorder, setShowObservationRecorder] = useState(false)
  const [editingCircuitIndex, setEditingCircuitIndex] = useState<number | null>(null)
  const [editingObsIndex, setEditingObsIndex] = useState<number | null>(null)

  // --- Derived state ---
  const boards = certificate.distributionBoards ?? []
  const activeBoard = boards[activeDbIndex]
  const circuits = certificate.circuits ?? []
  const observations = certificate.observations ?? []
  const supply = certificate.supplyCharacteristics ?? EMPTY_SUPPLY
  const particulars = certificate.installationParticulars ?? EMPTY_PARTICULARS
  const inspectionItems = certificate.inspectionSchedule ?? []

  const earthingType = supply.earthingType

  // Circuits for current board
  const boardCircuits = useMemo(
    () => circuits.filter((c) => c.dbId === activeBoard?.dbReference),
    [circuits, activeBoard]
  )

  // Observation counts
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
        setCertificate((prev) => {
          const existing = [...(prev.circuits ?? [])]
          if (editingCircuitIndex !== null) {
            existing[editingCircuitIndex] = { ...existing[editingCircuitIndex], ...circuit }
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
            }
            existing.push(newCircuit)
          }
          return { ...prev, circuits: existing, updatedAt: new Date().toISOString() }
        })
        trackCircuitCaptured(circuit.circuitType ?? 'UNKNOWN', 'voice')
        setShowCircuitRecorder(false)
        setEditingCircuitIndex(null)
      } catch (error) {
        captureError(error, 'InspectionCapture.handleCircuitConfirmed')
      }
    },
    [editingCircuitIndex, activeBoard]
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
            existing[editingObsIndex] = { ...existing[editingObsIndex], ...observation }
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
            }
            existing.push(newObs)
          }
          return { ...prev, observations: existing, updatedAt: new Date().toISOString() }
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
    [editingObsIndex, activeBoard]
  )

  // ============================================================
  // HANDLERS: SUPPLY
  // ============================================================

  const handleSupplyChange = useCallback((updated: SupplyCharacteristics) => {
    setCertificate((prev) => ({
      ...prev,
      supplyCharacteristics: updated,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const handleParticularsChange = useCallback((updated: InstallationParticulars) => {
    setCertificate((prev) => ({
      ...prev,
      installationParticulars: updated,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

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
          return { ...prev, inspectionSchedule: items, updatedAt: new Date().toISOString() }
        })
      } catch (error) {
        captureError(error, 'InspectionCapture.handleItemChange')
      }
    },
    []
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
        return { ...prev, inspectionSchedule: updated, updatedAt: new Date().toISOString() }
      })
    } catch (error) {
      captureError(error, 'InspectionCapture.handleBulkPass')
    }
  }, [])

  // ============================================================
  // HANDLERS: DB MANAGEMENT
  // ============================================================

  const handleAddBoard = useCallback(() => {
    setCertificate((prev) => {
      const existing = [...(prev.distributionBoards ?? [])]
      const newRef = `DB${existing.length + 1}`
      existing.push({
        dbReference: newRef,
        dbLocation: '',
      } as DistributionBoardHeader)
      return { ...prev, distributionBoards: existing }
    })
  }, [])

  // ============================================================
  // HANDLERS: SAVE
  // ============================================================

  const handleSave = useCallback(() => {
    try {
      // TODO: Save to API in Phase 6
      const updatedCert = { ...certificate, updatedAt: new Date().toISOString() }
      setCertificate(updatedCert)
      // For now, show a simple confirmation
    } catch (error) {
      captureError(error, 'InspectionCapture.handleSave')
    }
  }, [certificate])

  // ============================================================
  // TAB CONFIG
  // ============================================================

  const TABS: { id: CaptureTab; label: string; icon: typeof Zap; count?: number }[] = [
    { id: 'circuits', label: 'Circuits', icon: CircuitBoard, count: circuits.length },
    { id: 'observations', label: 'Observations', icon: AlertTriangle, count: observations.length },
    { id: 'supply', label: 'Supply', icon: Settings2 },
    { id: 'checklist', label: 'Checklist', icon: ClipboardList },
  ]

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
            Tap + to record test results by voice
          </p>
        </div>
      ) : (
        boardCircuits.map((circuit, idx) => {
          const globalIdx = circuits.findIndex(
            (c) => c.circuitNumber === circuit.circuitNumber && c.dbId === circuit.dbId
          )
          const isPass = circuit.status === 'SATISFACTORY'
          return (
            <button
              key={`${circuit.circuitNumber}-${idx}`}
              type="button"
              onClick={() => {
                setEditingCircuitIndex(globalIdx)
                setShowCircuitRecorder(true)
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
              {circuit.remarks && (
                <div className="text-[10px] text-certvoice-muted mt-1">
                  {circuit.remarks}
                </div>
              )}
            </button>
          )
        })
      )}

      {/* Add circuit button */}
      <button
        type="button"
        onClick={() => {
          setEditingCircuitIndex(null)
          setShowCircuitRecorder(true)
        }}
        className="cv-btn-primary w-full flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Record Circuit
      </button>

      {/* Circuit Recorder */}
      {showCircuitRecorder && (
        <CircuitRecorder
          locationContext={activeBoard?.dbLocation ?? ''}
          dbContext={activeBoard?.dbReference ?? 'DB1'}
          existingCircuits={boardCircuits.map((c) => c.circuitNumber ?? '')}
          earthingType={earthingType}
          onCircuitConfirmed={handleCircuitConfirmed}
          onCancel={() => {
            setShowCircuitRecorder(false)
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
      {/* Summary badges */}
      {observations.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {obsCounts.C1 > 0 && (
            <span className="cv-code-c1 text-xs px-2 py-1 rounded font-semibold">
              C1: {obsCounts.C1}
            </span>
          )}
          {obsCounts.C2 > 0 && (
            <span className="cv-code-c2 text-xs px-2 py-1 rounded font-semibold">
              C2: {obsCounts.C2}
            </span>
          )}
          {obsCounts.C3 > 0 && (
            <span className="cv-code-c3 text-xs px-2 py-1 rounded font-semibold">
              C3: {obsCounts.C3}
            </span>
          )}
          {obsCounts.FI > 0 && (
            <span className="cv-code-fi text-xs px-2 py-1 rounded font-semibold">
              FI: {obsCounts.FI}
            </span>
          )}
          {hasUnsatisfactory && (
            <span className="cv-badge-fail text-[10px] ml-auto">UNSATISFACTORY</span>
          )}
        </div>
      )}

      {/* Observation list */}
      {observations.length === 0 ? (
        <div className="cv-panel text-center py-8">
          <AlertTriangle className="w-6 h-6 text-certvoice-muted/40 mx-auto mb-2" />
          <p className="text-xs text-certvoice-muted">No observations recorded</p>
          <p className="text-[10px] text-certvoice-muted/60 mt-1">
            Voice-capture defects to add them
          </p>
        </div>
      ) : (
        observations.map((obs, idx) => (
          <button
            key={`obs-${obs.itemNumber}-${idx}`}
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
                  obs.classificationCode === 'C1'
                    ? 'cv-code-c1'
                    : obs.classificationCode === 'C2'
                      ? 'cv-code-c2'
                      : obs.classificationCode === 'C3'
                        ? 'cv-code-c3'
                        : 'cv-code-fi'
                }`}
              >
                {obs.classificationCode}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-certvoice-text line-clamp-2">
                  {obs.observationText ?? ''}
                </div>
                {obs.regulationReference && (
                  <div className="text-[10px] text-certvoice-muted mt-1 font-mono">
                    {obs.regulationReference}
                  </div>
                )}
              </div>
            </div>
          </button>
        ))
      )}

      {/* Add observation button */}
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

      {/* Observation Recorder */}
      {showObservationRecorder && (
        <ObservationRecorder
          locationContext={activeBoard?.dbLocation ?? ''}
          dbContext={activeBoard?.dbReference ?? 'DB1'}
          nextItemNumber={observations.length + 1}
          earthingType={earthingType}
          existingCircuits={boardCircuits.map((c) => c.circuitNumber ?? '')}
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
  // RENDER: SUPPLY TAB
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
  // RENDER: CHECKLIST TAB
  // ============================================================

  const renderChecklistTab = () => (
    <InspectionChecklist
      items={inspectionItems}
      onItemChange={handleItemChange}
      onBulkPass={handleBulkPass}
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
            to="/"
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
              {certificate.reportNumber} ·{' '}
              {certificate.installationDetails?.installationAddress
                ? certificate.clientDetails?.clientName ?? ''
                : ''}
            </p>
          </div>
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
