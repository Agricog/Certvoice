// ============================================================
// src/pages/InspectionCapture.tsx
// CertVoice - Main Inspection Capture Workflow
// Phase 3: Certificate Assembly - Item #29
// ============================================================

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  ArrowLeft,
  Battery,
  Camera,
  Check,
  CheckSquare,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Eye,
  Edit3,
  Mic,
  MoreVertical,
  Plus,
  Save,
  Trash2,
  AlertTriangle,
  Zap,
} from 'lucide-react'
import CircuitRecorder from '../components/CircuitRecorder'
import ObservationRecorder from '../components/ObservationRecorder'
import SupplyDetails from '../components/SupplyDetails'
import InspectionChecklist from '../components/InspectionChecklist'
import { captureError } from '../utils/errorTracking'
import { trackInspectionProgress } from '../utils/analytics'
import type {
  EICRCertificate,
  CircuitDetail,
  Observation,
  InspectionItem,
  SupplyCharacteristics,
  InstallationParticulars,
} from '../types/eicr'

// ============================================================
// TYPES
// ============================================================

type CaptureTab = 'supply' | 'circuits' | 'observations' | 'checklist'

interface TabConfig {
  id: CaptureTab
  label: string
  icon: React.ReactNode
  badge?: number | string
  badgeColor?: 'green' | 'amber' | 'red'
}

interface CaptureMode {
  type: 'idle' | 'circuit' | 'observation'
  editingId?: string
}

// ============================================================
// COMPONENT
// ============================================================

export default function InspectionCapture() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // State
  const [certificate, setCertificate] = useState<Partial<EICRCertificate> | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<CaptureTab>('supply')
  const [captureMode, setCaptureMode] = useState<CaptureMode>({ type: 'idle' })
  const [showMenu, setShowMenu] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [activeDBIndex, setActiveDBIndex] = useState(0)
  const [showDBSelector, setShowDBSelector] = useState(false)

  // Load Certificate
  useEffect(() => {
    const loadCertificate = async () => {
      setIsLoading(true)
      try {
        const draftData = sessionStorage.getItem('certvoice_draft_certificate')
        if (draftData) {
          const parsed = JSON.parse(draftData)
          if (parsed.id === id) {
            setCertificate(parsed)
            setIsLoading(false)
            return
          }
        }
        setCertificate({
          id: id || crypto.randomUUID(),
          status: 'draft',
          circuits: [],
          observations: [],
          inspectionSchedule: [],
          distributionBoards: [{
            reference: 'DB1',
            location: 'Main Consumer Unit',
            suppliedFrom: 'Origin',
            numberOfPhases: 1,
          }],
        })
      } catch (error) {
        captureError(error, 'InspectionCapture.loadCertificate')
      } finally {
        setIsLoading(false)
      }
    }
    loadCertificate()
  }, [id])

  // Auto-save
  useEffect(() => {
    if (!certificate || !hasUnsavedChanges) return
    const saveTimer = setTimeout(() => {
      try {
        sessionStorage.setItem('certvoice_draft_certificate', JSON.stringify(certificate))
        setLastSaved(new Date())
        setHasUnsavedChanges(false)
      } catch (error) {
        captureError(error, 'InspectionCapture.autoSave')
      }
    }, 2000)
    return () => clearTimeout(saveTimer)
  }, [certificate, hasUnsavedChanges])

  // Computed values
  const circuitCount = certificate?.circuits?.length || 0
  const observationCount = certificate?.observations?.length || 0
  
  const observationsByCode = useMemo(() => {
    const counts = { C1: 0, C2: 0, C3: 0, FI: 0 }
    certificate?.observations?.forEach((obs) => {
      if (obs.classification in counts) {
        counts[obs.classification as keyof typeof counts]++
      }
    })
    return counts
  }, [certificate?.observations])

  const hasC1OrC2 = observationsByCode.C1 > 0 || observationsByCode.C2 > 0

  const checklistProgress = useMemo(() => {
    const items = certificate?.inspectionSchedule || []
    const completed = items.filter((item) => item.outcome && item.outcome !== 'NA').length
    return { completed, total: items.length || 70 }
  }, [certificate?.inspectionSchedule])

  const supplyComplete = Boolean(
    certificate?.supplyCharacteristics?.earthingType &&
    certificate?.supplyCharacteristics?.nominalVoltage
  )

  const tabs: TabConfig[] = [
    { id: 'supply', label: 'Supply', icon: <Zap className="w-4 h-4" />, badge: supplyComplete ? '✓' : '!', badgeColor: supplyComplete ? 'green' : 'amber' },
    { id: 'circuits', label: 'Circuits', icon: <CircleDot className="w-4 h-4" />, badge: circuitCount > 0 ? circuitCount : undefined, badgeColor: 'green' },
    { id: 'observations', label: 'Observations', icon: <AlertTriangle className="w-4 h-4" />, badge: observationCount > 0 ? observationCount : undefined, badgeColor: hasC1OrC2 ? 'red' : observationCount > 0 ? 'amber' : undefined },
    { id: 'checklist', label: 'Checklist', icon: <CheckSquare className="w-4 h-4" />, badge: checklistProgress.total > 0 ? `${checklistProgress.completed}/${checklistProgress.total}` : undefined, badgeColor: checklistProgress.completed === checklistProgress.total ? 'green' : 'amber' },
  ]

  // Handlers
  const handleSupplyUpdate = useCallback((supply: SupplyCharacteristics, particulars: InstallationParticulars) => {
    setCertificate((prev) => prev ? { ...prev, supplyCharacteristics: supply, installationParticulars: particulars, updatedAt: new Date().toISOString() } : null)
    setHasUnsavedChanges(true)
    trackInspectionProgress({ certificateId: id || '', section: 'supply', action: 'update' })
  }, [id])

  const handleCircuitAdd = useCallback((circuit: CircuitDetail) => {
    setCertificate((prev) => {
      if (!prev) return null
      return { ...prev, circuits: [...(prev.circuits || []), circuit], updatedAt: new Date().toISOString() }
    })
    setHasUnsavedChanges(true)
    setCaptureMode({ type: 'idle' })
    trackInspectionProgress({ certificateId: id || '', section: 'circuits', action: 'add', count: (certificate?.circuits?.length || 0) + 1 })
  }, [id, certificate?.circuits?.length])

  const handleCircuitUpdate = useCallback((circuitId: string, updates: Partial<CircuitDetail>) => {
    setCertificate((prev) => {
      if (!prev) return null
      return { ...prev, circuits: (prev.circuits || []).map((c) => c.id === circuitId ? { ...c, ...updates } : c), updatedAt: new Date().toISOString() }
    })
    setHasUnsavedChanges(true)
    setCaptureMode({ type: 'idle' })
  }, [])

  const handleCircuitDelete = useCallback((circuitId: string) => {
    if (!confirm('Delete this circuit?')) return
    setCertificate((prev) => {
      if (!prev) return null
      return { ...prev, circuits: (prev.circuits || []).filter((c) => c.id !== circuitId), updatedAt: new Date().toISOString() }
    })
    setHasUnsavedChanges(true)
  }, [])

  const handleObservationAdd = useCallback((observation: Observation) => {
    setCertificate((prev) => {
      if (!prev) return null
      return { ...prev, observations: [...(prev.observations || []), observation], updatedAt: new Date().toISOString() }
    })
    setHasUnsavedChanges(true)
    setCaptureMode({ type: 'idle' })
    trackInspectionProgress({ certificateId: id || '', section: 'observations', action: 'add', classification: observation.classification })
  }, [id])

  const handleObservationUpdate = useCallback((obsId: string, updates: Partial<Observation>) => {
    setCertificate((prev) => {
      if (!prev) return null
      return { ...prev, observations: (prev.observations || []).map((o) => o.id === obsId ? { ...o, ...updates } : o), updatedAt: new Date().toISOString() }
    })
    setHasUnsavedChanges(true)
    setCaptureMode({ type: 'idle' })
  }, [])

  const handleObservationDelete = useCallback((obsId: string) => {
    if (!confirm('Delete this observation?')) return
    setCertificate((prev) => {
      if (!prev) return null
      return { ...prev, observations: (prev.observations || []).filter((o) => o.id !== obsId), updatedAt: new Date().toISOString() }
    })
    setHasUnsavedChanges(true)
  }, [])

  const handleChecklistUpdate = useCallback((items: InspectionItem[]) => {
    setCertificate((prev) => prev ? { ...prev, inspectionSchedule: items, updatedAt: new Date().toISOString() } : null)
    setHasUnsavedChanges(true)
  }, [])

  const handleDistributionBoardAdd = useCallback(() => {
    setCertificate((prev) => {
      if (!prev) return null
      const boards = [...(prev.distributionBoards || [])]
      const newIndex = boards.length + 1
      boards.push({ reference: `DB${newIndex}`, location: '', suppliedFrom: boards.length === 0 ? 'Origin' : `DB${newIndex - 1}`, numberOfPhases: 1 })
      return { ...prev, distributionBoards: boards, updatedAt: new Date().toISOString() }
    })
    setHasUnsavedChanges(true)
  }, [])

  const handleSaveAndExit = useCallback(() => {
    try {
      if (certificate) sessionStorage.setItem('certvoice_draft_certificate', JSON.stringify(certificate))
      navigate('/')
    } catch (error) {
      captureError(error, 'InspectionCapture.handleSaveAndExit')
    }
  }, [certificate, navigate])

  const handleProceedToReview = useCallback(() => {
    if (circuitCount === 0) {
      alert('Please add at least one circuit.')
      setActiveTab('circuits')
      return
    }
    if (!supplyComplete) {
      alert('Please complete supply details.')
      setActiveTab('supply')
      return
    }
    try {
      if (certificate) sessionStorage.setItem('certvoice_draft_certificate', JSON.stringify(certificate))
      navigate(`/inspection/${id}/review`)
    } catch (error) {
      captureError(error, 'InspectionCapture.handleProceedToReview')
    }
  }, [certificate, circuitCount, supplyComplete, id, navigate])

  // Render Tab Bar
  const renderTabBar = () => (
    <div className="flex overflow-x-auto hide-scrollbar border-b border-border bg-surface">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setActiveTab(tab.id)}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text hover:bg-surface-2'}`}
        >
          {tab.icon}
          {tab.label}
          {tab.badge && (
            <span className={`px-1.5 py-0.5 text-xs rounded-full font-semibold ${tab.badgeColor === 'green' ? 'bg-green-500/20 text-green-500' : ''} ${tab.badgeColor === 'amber' ? 'bg-amber-500/20 text-amber-500' : ''} ${tab.badgeColor === 'red' ? 'bg-red-500/20 text-red-500' : ''}`}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )

  // Render Circuits Tab
  const renderCircuitsTab = () => (
    <div className="space-y-4">
      {(certificate?.distributionBoards?.length || 0) > 1 && (
        <div className="cv-panel">
          <button type="button" onClick={() => setShowDBSelector(!showDBSelector)} className="w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Battery className="w-5 h-5 text-accent" />
              <span className="font-medium">{certificate?.distributionBoards?.[activeDBIndex]?.reference || 'DB1'}</span>
              <span className="text-sm text-text-muted">- {certificate?.distributionBoards?.[activeDBIndex]?.location || 'Main Consumer Unit'}</span>
            </div>
            <ChevronDown className={`w-5 h-5 text-text-muted transition-transform ${showDBSelector ? 'rotate-180' : ''}`} />
          </button>
          {showDBSelector && (
            <div className="mt-3 pt-3 border-t border-border space-y-2">
              {certificate?.distributionBoards?.map((db, index) => (
                <button key={db.reference} type="button" onClick={() => { setActiveDBIndex(index); setShowDBSelector(false) }} className={`w-full p-3 rounded-lg text-left transition-colors ${index === activeDBIndex ? 'bg-accent/10 border border-accent' : 'bg-surface-2 hover:bg-surface-2/80'}`}>
                  <div className="font-medium">{db.reference}</div>
                  <div className="text-sm text-text-muted">{db.location || 'Location not set'}</div>
                </button>
              ))}
              <button type="button" onClick={handleDistributionBoardAdd} className="w-full p-3 rounded-lg border-2 border-dashed border-border text-text-muted hover:border-accent hover:text-accent transition-colors flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" />Add Distribution Board
              </button>
            </div>
          )}
        </div>
      )}

      {certificate?.circuits && certificate.circuits.length > 0 ? (
        <div className="space-y-3">
          {certificate.circuits.filter((c) => !c.dbReference || c.dbReference === certificate.distributionBoards?.[activeDBIndex]?.reference).map((circuit, index) => (
            <div key={circuit.id} className="cv-panel hover:border-accent/50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="cv-badge bg-surface-2 text-text font-mono">Cct {circuit.circuitNumber || index + 1}</span>
                    <span className="font-medium text-text">{circuit.description}</span>
                  </div>
                  <div className="text-sm text-text-muted mt-1">
                    {circuit.location && <span>{circuit.location} • </span>}
                    {circuit.ocpdType}{circuit.ocpdRating}A
                    {circuit.zs && <span> • Zs: {circuit.zs}Ω</span>}
                  </div>
                  {circuit.status && (
                    <span className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${circuit.status === 'satisfactory' ? 'text-green-500' : 'text-amber-500'}`}>
                      {circuit.status === 'satisfactory' ? <><Check className="w-3 h-3" /> Satisfactory</> : <><AlertTriangle className="w-3 h-3" /> {circuit.status}</>}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setCaptureMode({ type: 'circuit', editingId: circuit.id })} className="p-2 rounded-lg hover:bg-surface-2 text-text-muted" aria-label="Edit circuit"><Edit3 className="w-4 h-4" /></button>
                  <button type="button" onClick={() => handleCircuitDelete(circuit.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500" aria-label="Delete circuit"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cv-panel text-center py-8">
          <CircleDot className="w-12 h-12 mx-auto text-text-muted mb-3" />
          <h3 className="font-semibold text-text mb-1">No Circuits Recorded</h3>
          <p className="text-sm text-text-muted mb-4">Use voice capture to quickly record circuit test results</p>
        </div>
      )}

      {captureMode.type === 'idle' && (
        <button type="button" onClick={() => setCaptureMode({ type: 'circuit' })} className="cv-btn-primary w-full flex items-center justify-center gap-2">
          <Mic className="w-5 h-5" />Record Circuit Test Results
        </button>
      )}

      {captureMode.type === 'circuit' && (
        <div className="fixed inset-0 z-50 bg-bg/95 overflow-y-auto">
          <div className="min-h-screen p-4">
            <div className="max-w-2xl mx-auto">
              <CircuitRecorder
                dbReference={certificate?.distributionBoards?.[activeDBIndex]?.reference || 'DB1'}
                existingCircuit={captureMode.editingId ? certificate?.circuits?.find((c) => c.id === captureMode.editingId) : undefined}
                onConfirm={(circuit) => {
                  if (captureMode.editingId) {
                    handleCircuitUpdate(captureMode.editingId, circuit)
                  } else {
                    handleCircuitAdd({ ...circuit, id: crypto.randomUUID(), dbReference: certificate?.distributionBoards?.[activeDBIndex]?.reference || 'DB1' })
                  }
                }}
                onCancel={() => setCaptureMode({ type: 'idle' })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // Render Observations Tab
  const renderObservationsTab = () => (
    <div className="space-y-4">
      {observationCount > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {(['C1', 'C2', 'C3', 'FI'] as const).map((code) => (
            <div key={code} className={`cv-panel text-center py-3 ${code === 'C1' ? 'cv-code-c1' : ''} ${code === 'C2' ? 'cv-code-c2' : ''} ${code === 'C3' ? 'cv-code-c3' : ''} ${code === 'FI' ? 'cv-code-fi' : ''}`}>
              <div className="text-2xl font-bold">{observationsByCode[code]}</div>
              <div className="text-xs opacity-80">{code}</div>
            </div>
          ))}
        </div>
      )}

      {certificate?.observations && certificate.observations.length > 0 ? (
        <div className="space-y-3">
          {certificate.observations.map((obs, index) => (
            <div key={obs.id} className={`cv-panel ${obs.classification === 'C1' ? 'border-red-500/50 bg-red-500/5' : ''} ${obs.classification === 'C2' ? 'border-amber-500/50 bg-amber-500/5' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`cv-badge font-semibold ${obs.classification === 'C1' ? 'cv-code-c1' : ''} ${obs.classification === 'C2' ? 'cv-code-c2' : ''} ${obs.classification === 'C3' ? 'cv-code-c3' : ''} ${obs.classification === 'FI' ? 'cv-code-fi' : ''}`}>{obs.classification}</span>
                    <span className="text-sm text-text-muted">Item {index + 1}</span>
                  </div>
                  <p className="text-text">{obs.description}</p>
                  {obs.location && <p className="text-sm text-text-muted mt-1">Location: {obs.location}</p>}
                  {obs.regulation && <p className="text-xs text-text-muted mt-1 font-mono">Reg: {obs.regulation}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setCaptureMode({ type: 'observation', editingId: obs.id })} className="p-2 rounded-lg hover:bg-surface-2 text-text-muted" aria-label="Edit"><Edit3 className="w-4 h-4" /></button>
                  <button type="button" onClick={() => handleObservationDelete(obs.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cv-panel text-center py-8">
          <AlertTriangle className="w-12 h-12 mx-auto text-text-muted mb-3" />
          <h3 className="font-semibold text-text mb-1">No Observations Recorded</h3>
          <p className="text-sm text-text-muted mb-4">Record defects and non-compliances found during inspection</p>
        </div>
      )}

      {captureMode.type === 'idle' && (
        <button type="button" onClick={() => setCaptureMode({ type: 'observation' })} className="cv-btn-primary w-full flex items-center justify-center gap-2">
          <Mic className="w-5 h-5" />Record Observation
        </button>
      )}

      {captureMode.type === 'observation' && (
        <div className="fixed inset-0 z-50 bg-bg/95 overflow-y-auto">
          <div className="min-h-screen p-4">
            <div className="max-w-2xl mx-auto">
              <ObservationRecorder
                existingObservation={captureMode.editingId ? certificate?.observations?.find((o) => o.id === captureMode.editingId) : undefined}
                dbReference={certificate?.distributionBoards?.[activeDBIndex]?.reference}
                onConfirm={(observation) => {
                  if (captureMode.editingId) {
                    handleObservationUpdate(captureMode.editingId, observation)
                  } else {
                    handleObservationAdd({ ...observation, id: crypto.randomUUID(), itemNumber: (certificate?.observations?.length || 0) + 1 })
                  }
                }}
                onCancel={() => setCaptureMode({ type: 'idle' })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // Render Active Tab
  const renderActiveTab = () => {
    switch (activeTab) {
      case 'supply':
        return <SupplyDetails initialSupply={certificate?.supplyCharacteristics} initialParticulars={certificate?.installationParticulars} onUpdate={handleSupplyUpdate} />
      case 'circuits':
        return renderCircuitsTab()
      case 'observations':
        return renderObservationsTab()
      case 'checklist':
        return <InspectionChecklist items={certificate?.inspectionSchedule || []} onUpdate={handleChecklistUpdate} />
      default:
        return null
    }
  }

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted">Loading inspection...</p>
        </div>
      </div>
    )
  }

  // Main Render
  return (
    <>
      <Helmet>
        <title>{certificate?.sectionC?.installationAddress ? `Inspection - ${certificate.sectionC.installationAddress.split('\n')[0]}` : 'Inspection Capture'} | CertVoice</title>
      </Helmet>

      <div className="min-h-screen bg-bg pb-24">
        <header className="bg-surface border-b border-border sticky top-0 z-40">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button type="button" onClick={handleSaveAndExit} className="p-2 rounded-lg hover:bg-surface-2 text-text-muted" aria-label="Save and exit">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <h1 className="font-semibold text-text truncate">{certificate?.sectionC?.installationAddress?.split('\n')[0] || 'New Inspection'}</h1>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span>{certificate?.reportNumber || 'Draft'}</span>
                  {lastSaved && <><span>•</span><span>Saved {lastSaved.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></>}
                  {hasUnsavedChanges && <span className="text-amber-500">• Unsaved changes</span>}
                </div>
              </div>
            </div>
            <button type="button" onClick={() => setShowMenu(!showMenu)} className="p-2 rounded-lg hover:bg-surface-2 text-text-muted" aria-label="Menu">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
          {renderTabBar()}
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-4 top-14 z-50 w-56 bg-surface border border-border rounded-lg shadow-xl py-1">
                <button type="button" onClick={() => { setShowMenu(false); handleProceedToReview() }} className="w-full px-4 py-2 text-left text-sm hover:bg-surface-2 flex items-center gap-2">
                  <Eye className="w-4 h-4" />Review Certificate
                </button>
                <button type="button" onClick={() => setShowMenu(false)} className="w-full px-4 py-2 text-left text-sm hover:bg-surface-2 flex items-center gap-2">
                  <Camera className="w-4 h-4" />Add Photo Evidence
                </button>
                <hr className="my-1 border-border" />
                <button type="button" onClick={() => { setShowMenu(false); handleSaveAndExit() }} className="w-full px-4 py-2 text-left text-sm hover:bg-surface-2 flex items-center gap-2">
                  <Save className="w-4 h-4" />Save & Exit
                </button>
              </div>
            </>
          )}
        </header>

        <main className="max-w-4xl mx-auto px-4 py-6">{renderActiveTab()}</main>

        <footer className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="text-sm text-text-muted">
              <span className="font-medium text-text">{circuitCount}</span> circuits • <span className="font-medium text-text">{observationCount}</span> observations
            </div>
            <button type="button" onClick={handleProceedToReview} className="cv-btn-primary flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4" />Review Certificate
            </button>
          </div>
        </footer>
      </div>
    </>
  )
}
