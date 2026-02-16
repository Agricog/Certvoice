/**
 * CertVoice — Certificate API Service
 *
 * Typed functions for all certificate CRUD endpoints.
 * Used by InspectionCapture and the sync service.
 *
 * All calls use Bearer token auth via Clerk.
 * All calls go through VITE_API_BASE_URL.
 *
 * @module services/certificateApi
 */

import type {
  EICRCertificate,
  CircuitDetail,
  Observation,
  DistributionBoardHeader,
} from '../types/eicr'

// ============================================================
// CONFIG
// ============================================================

const API_BASE = (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL : '') ?? ''

// ============================================================
// TYPES
// ============================================================

export interface CertificateListItem {
  id: string
  reportNumber: string
  status: string
  certificateType: string
  clientDetails: { clientName: string; clientAddress: string }
  installationDetails: { installationAddress: string }
  reportReason: { purpose: string; inspectionDates: string[] }
  overallAssessment: string | null
  circuitCount: number
  observationCounts: { C1: number; C2: number; C3: number; FI: number }
  hasPdf: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateCertificateParams {
  certificateType?: string
  clientName?: string
  clientAddress?: string
  installationAddress?: string
  installationPostcode?: string
  purpose?: string
  inspectionDates?: string[]
  premisesType?: string
  extentOfInspection?: string
  agreedLimitations?: string
  operationalLimitations?: string
}

export interface ApiError {
  error: string
  requestId?: string
}

export interface SyncStats {
  boardsUpserted: number
  circuitsUpserted: number
  observationsUpserted: number
}

// ============================================================
// HELPERS
// ============================================================

async function apiCall<T>(
  path: string,
  getToken: () => Promise<string | null>,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error((data as ApiError).error ?? `API error ${response.status}`)
  }

  return data as T
}

// ============================================================
// CERTIFICATE CRUD
// ============================================================

export async function listCertificates(
  getToken: () => Promise<string | null>,
  params?: { status?: string; limit?: number }
): Promise<{ data: CertificateListItem[] }> {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  if (params?.limit) query.set('limit', String(params.limit))
  const qs = query.toString()
  return apiCall(`/api/certificates${qs ? `?${qs}` : ''}`, getToken)
}

export async function getCertificate(
  getToken: () => Promise<string | null>,
  certId: string
): Promise<Partial<EICRCertificate>> {
  return apiCall(`/api/certificates/${certId}`, getToken)
}

export async function createCertificate(
  getToken: () => Promise<string | null>,
  params: CreateCertificateParams
): Promise<{ id: string; reportNumber: string; status: string; createdAt: string }> {
  return apiCall('/api/certificates', getToken, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function updateCertificate(
  getToken: () => Promise<string | null>,
  certId: string,
  updates: Record<string, unknown>
): Promise<{ id: string; status: string; updatedAt: string }> {
  return apiCall(`/api/certificates/${certId}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export async function deleteCertificate(
  getToken: () => Promise<string | null>,
  certId: string
): Promise<{ deleted: boolean; id: string }> {
  return apiCall(`/api/certificates/${certId}`, getToken, {
    method: 'DELETE',
  })
}

// ============================================================
// CIRCUIT CRUD
// ============================================================

export async function addCircuit(
  getToken: () => Promise<string | null>,
  certId: string,
  circuit: Partial<CircuitDetail> & { voiceTranscript?: string; captureMethod?: string; dbLocation?: string }
): Promise<{ circuit: CircuitDetail }> {
  return apiCall(`/api/certificates/${certId}/circuits`, getToken, {
    method: 'POST',
    body: JSON.stringify(circuit),
  })
}

export async function updateCircuit(
  getToken: () => Promise<string | null>,
  certId: string,
  circuitId: string,
  updates: Partial<CircuitDetail>
): Promise<{ circuit: CircuitDetail }> {
  return apiCall(`/api/certificates/${certId}/circuits/${circuitId}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export async function deleteCircuit(
  getToken: () => Promise<string | null>,
  certId: string,
  circuitId: string
): Promise<{ deleted: boolean; id: string }> {
  return apiCall(`/api/certificates/${certId}/circuits/${circuitId}`, getToken, {
    method: 'DELETE',
  })
}

// ============================================================
// OBSERVATION CRUD
// ============================================================

export async function addObservation(
  getToken: () => Promise<string | null>,
  certId: string,
  observation: Partial<Observation> & { voiceTranscript?: string; captureMethod?: string }
): Promise<{ observation: Observation }> {
  return apiCall(`/api/certificates/${certId}/observations`, getToken, {
    method: 'POST',
    body: JSON.stringify(observation),
  })
}

export async function updateObservation(
  getToken: () => Promise<string | null>,
  certId: string,
  obsId: string,
  updates: Partial<Observation>
): Promise<{ observation: Observation }> {
  return apiCall(`/api/certificates/${certId}/observations/${obsId}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export async function deleteObservation(
  getToken: () => Promise<string | null>,
  certId: string,
  obsId: string
): Promise<{ deleted: boolean; id: string }> {
  return apiCall(`/api/certificates/${certId}/observations/${obsId}`, getToken, {
    method: 'DELETE',
  })
}

// ============================================================
// BOARD CRUD
// ============================================================

export async function addBoard(
  getToken: () => Promise<string | null>,
  certId: string,
  board: Partial<DistributionBoardHeader>
): Promise<{ board: DistributionBoardHeader }> {
  return apiCall(`/api/certificates/${certId}/boards`, getToken, {
    method: 'POST',
    body: JSON.stringify(board),
  })
}

export async function updateBoard(
  getToken: () => Promise<string | null>,
  certId: string,
  boardId: string,
  updates: Partial<DistributionBoardHeader>
): Promise<{ board: DistributionBoardHeader }> {
  return apiCall(`/api/certificates/${certId}/boards/${boardId}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

// ============================================================
// SYNC (offline-first bulk reconciliation)
// ============================================================

export async function syncCertificate(
  getToken: () => Promise<string | null>,
  certId: string,
  certificate: Partial<EICRCertificate>
): Promise<{ synced: boolean; stats: SyncStats }> {
  return apiCall(`/api/certificates/${certId}/sync`, getToken, {
    method: 'PUT',
    body: JSON.stringify({
      distributionBoards: certificate.distributionBoards ?? [],
      circuits: certificate.circuits ?? [],
      observations: certificate.observations ?? [],
    }),
  })
}
