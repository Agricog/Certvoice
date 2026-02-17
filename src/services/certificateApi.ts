/**
 * CertVoice — Certificate API Service (v2)
 *
 * Typed functions for all certificate CRUD endpoints.
 * Used by InspectionCapture and the sync service.
 *
 * v2 changes:
 *   - Null token guard: throws ApiAuthError, never sends "Bearer null"
 *   - Retry-After: reads header on 429, exposes retryAfterSeconds
 *   - Canonical error types: ApiAuthError, ApiRateLimitError, ApiError
 *   - Last-modified: sync sends lastModified for conflict detection
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
// ERRORS
// ============================================================

export class ApiAuthError extends Error {
  constructor(message = 'Not authenticated') {
    super(message)
    this.name = 'ApiAuthError'
  }
}

export class ApiRateLimitError extends Error {
  public retryAfterSeconds: number
  constructor(retryAfter: number) {
    super(`Rate limited. Retry after ${retryAfter}s`)
    this.name = 'ApiRateLimitError'
    this.retryAfterSeconds = retryAfter
  }
}

export class ApiError extends Error {
  public status: number
  public requestId?: string
  constructor(status: number, message: string, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.requestId = requestId
  }
}

// ============================================================
// TYPES
// ============================================================

/** Token getter — from useApiToken hook. Can return string or string|null */
type TokenGetter = () => Promise<string | null>

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
  purpose?: string
  inspectionDates?: string[]
  premisesType?: string
  extentOfInspection?: string
  agreedLimitations?: string
  operationalLimitations?: string
}

export interface SyncStats {
  boardsUpserted: number
  circuitsUpserted: number
  observationsUpserted: number
}

// ============================================================
// CORE API CALLER
// ============================================================

async function apiCall<T>(
  path: string,
  getToken: TokenGetter,
  options: RequestInit = {}
): Promise<T> {
  // --- Guard: never send "Bearer null" ---
  const token = await getToken()
  if (!token) {
    throw new ApiAuthError('No auth token available — sign in required')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })

  // --- Handle 429 with Retry-After ---
  if (response.status === 429) {
    const retryHeader = response.headers.get('Retry-After')
    const retrySeconds = retryHeader ? parseInt(retryHeader, 10) : 60
    throw new ApiRateLimitError(isNaN(retrySeconds) ? 60 : retrySeconds)
  }

  // --- Handle 401 (session expired mid-request) ---
  if (response.status === 401) {
    throw new ApiAuthError('Session expired or invalid')
  }

  // --- Parse response ---
  const data = await response.json()

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error ?? `API error ${response.status}`,
      data?.requestId
    )
  }

  return data as T
}

// ============================================================
// CERTIFICATE CRUD
// ============================================================

export async function listCertificates(
  getToken: TokenGetter,
  params?: { status?: string; limit?: number }
): Promise<{ data: CertificateListItem[] }> {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  if (params?.limit) query.set('limit', String(params.limit))
  const qs = query.toString()
  return apiCall(`/api/certificates${qs ? `?${qs}` : ''}`, getToken)
}

export async function getCertificate(
  getToken: TokenGetter,
  certId: string
): Promise<Partial<EICRCertificate>> {
  return apiCall(`/api/certificates/${certId}`, getToken)
}

export async function createCertificate(
  getToken: TokenGetter,
  params: CreateCertificateParams
): Promise<{ id: string; reportNumber: string; status: string; createdAt: string }> {
  return apiCall('/api/certificates', getToken, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function updateCertificate(
  getToken: TokenGetter,
  certId: string,
  updates: Record<string, unknown>
): Promise<{ id: string; status: string; updatedAt: string }> {
  return apiCall(`/api/certificates/${certId}`, getToken, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export async function deleteCertificate(
  getToken: TokenGetter,
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
  getToken: TokenGetter,
  certId: string,
  circuit: Partial<CircuitDetail> & { voiceTranscript?: string; captureMethod?: string; dbLocation?: string }
): Promise<{ circuit: CircuitDetail }> {
  return apiCall(`/api/certificates/${certId}/circuits`, getToken, {
    method: 'POST',
    body: JSON.stringify(circuit),
  })
}

export async function updateCircuit(
  getToken: TokenGetter,
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
  getToken: TokenGetter,
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
  getToken: TokenGetter,
  certId: string,
  observation: Partial<Observation> & { voiceTranscript?: string; captureMethod?: string }
): Promise<{ observation: Observation }> {
  return apiCall(`/api/certificates/${certId}/observations`, getToken, {
    method: 'POST',
    body: JSON.stringify(observation),
  })
}

export async function updateObservation(
  getToken: TokenGetter,
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
  getToken: TokenGetter,
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
  getToken: TokenGetter,
  certId: string,
  board: Partial<DistributionBoardHeader>
): Promise<{ board: DistributionBoardHeader }> {
  return apiCall(`/api/certificates/${certId}/boards`, getToken, {
    method: 'POST',
    body: JSON.stringify(board),
  })
}

export async function updateBoard(
  getToken: TokenGetter,
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
  getToken: TokenGetter,
  certId: string,
  certificate: Partial<EICRCertificate>,
  lastModified?: string
): Promise<{ synced: boolean; stats: SyncStats }> {
  return apiCall(`/api/certificates/${certId}/sync`, getToken, {
    method: 'PUT',
    body: JSON.stringify({
      distributionBoards: certificate.distributionBoards ?? [],
      circuits: certificate.circuits ?? [],
      observations: certificate.observations ?? [],
      lastModified: lastModified ?? new Date().toISOString(),
    }),
  })
}
