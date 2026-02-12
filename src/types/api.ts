/**
 * CertVoice — API Request/Response Types
 *
 * Types for all API interactions:
 *   - Claude AI extraction (voice transcript → structured data)
 *   - PDF generation
 *   - R2 file uploads
 *   - Certificate CRUD operations
 */

import type {
  CircuitDetail,
  Observation,
  SupplyCharacteristics,
  ClassificationCode,
  EICRCertificate,
  Job,
  EngineerProfile,
} from './eicr'

// ============================================================
// AI EXTRACTION (Claude API via Cloudflare Worker)
// ============================================================

/** The type of data the AI extracted from voice */
export type ExtractionType = 'circuit' | 'observation' | 'supply'

/** Request to the Claude proxy worker */
export interface AIExtractionRequest {
  /** Raw voice transcript text */
  transcript: string
  /** Current room/location context from room selector */
  locationContext: string
  /** Current distribution board context */
  dbContext: string
  /** Existing circuit numbers (to avoid duplicates) */
  existingCircuits: string[]
  /** Earthing type (needed for max Zs lookups) */
  earthingType: string | null
}

/** Response from the Claude proxy worker */
export interface AIExtractionResponse {
  /** Whether extraction was successful */
  success: boolean
  /** What type of data was extracted */
  type: ExtractionType
  /** Confidence score 0-1 */
  confidence: number
  /** Extracted circuit data (if type === 'circuit') */
  circuit?: Partial<CircuitDetail>
  /** Extracted observation data (if type === 'observation') */
  observation?: Partial<Observation>
  /** Extracted supply data (if type === 'supply') */
  supply?: Partial<SupplyCharacteristics>
  /** Validation warnings generated during extraction */
  warnings: string[]
  /** Raw AI reasoning (for debugging, never shown to user) */
  debugReasoning?: string
}

/** Error response from the AI proxy */
export interface AIExtractionError {
  success: false
  error: string
  code: 'PARSE_FAILED' | 'RATE_LIMITED' | 'API_ERROR' | 'INVALID_INPUT'
  retryAfter?: number
}

// ============================================================
// PDF GENERATION
// ============================================================

/** Request to the PDF generation worker */
export interface PDFGenerateRequest {
  /** Complete certificate data */
  certificate: EICRCertificate
  /** Engineer profile for branding/signatures */
  engineerProfile: EngineerProfile
  /** Include company logo on PDF */
  includeLogo: boolean
}

/** Response from the PDF generation worker */
export interface PDFGenerateResponse {
  /** Whether generation was successful */
  success: boolean
  /** R2 storage key for the generated PDF */
  pdfKey: string
  /** Signed download URL (expires in 1 hour) */
  downloadUrl: string
  /** URL expiry timestamp — ISO format */
  expiresAt: string
  /** Number of pages generated */
  pageCount: number
}

// ============================================================
// R2 FILE UPLOADS
// ============================================================

/** Request for a signed upload URL */
export interface R2UploadUrlRequest {
  /** Original filename */
  filename: string
  /** MIME content type */
  contentType: string
  /** Upload category */
  category: 'photo_evidence' | 'signature' | 'company_logo'
  /** Certificate ID (for photo evidence) */
  certificateId?: string
  /** Observation ID (for photo evidence) */
  observationId?: string
}

/** Response with signed upload URL */
export interface R2UploadUrlResponse {
  /** Signed upload URL */
  uploadUrl: string
  /** R2 storage key */
  key: string
  /** URL expiry in seconds */
  expiresIn: number
}

/** Request for a signed download URL */
export interface R2DownloadUrlRequest {
  /** R2 storage key */
  key: string
}

/** Response with signed download URL */
export interface R2DownloadUrlResponse {
  /** Signed download URL */
  downloadUrl: string
  /** URL expiry in seconds */
  expiresIn: number
}

// ============================================================
// CERTIFICATE CRUD
// ============================================================

/** Create a new certificate */
export interface CreateCertificateRequest {
  /** Client name */
  clientName: string
  /** Client address */
  clientAddress: string
  /** Installation/property address */
  installationAddress: string
  /** Report purpose */
  purpose: string
}

/** Update certificate data (partial update) */
export interface UpdateCertificateRequest {
  /** Certificate ID */
  certificateId: string
  /** Partial certificate data to update */
  data: Partial<EICRCertificate>
}

/** List certificates with filtering */
export interface ListCertificatesRequest {
  /** Filter by status */
  status?: string
  /** Search by address or client name */
  search?: string
  /** Pagination: page number (1-indexed) */
  page: number
  /** Pagination: items per page */
  perPage: number
  /** Sort field */
  sortBy: 'updatedAt' | 'createdAt' | 'reportNumber'
  /** Sort direction */
  sortOrder: 'asc' | 'desc'
}

/** Paginated list response */
export interface PaginatedResponse<T> {
  /** Items in current page */
  items: T[]
  /** Total number of items */
  total: number
  /** Current page number */
  page: number
  /** Items per page */
  perPage: number
  /** Total number of pages */
  totalPages: number
}

// ============================================================
// JOB CRUD
// ============================================================

/** Create a new job */
export interface CreateJobRequest {
  /** Client name */
  clientName: string
  /** Property address */
  propertyAddress: string
  /** Property postcode */
  postcode: string
  /** Scheduled date — ISO format */
  jobDate: string
  /** Notes */
  notes?: string
}

/** Update job data */
export interface UpdateJobRequest {
  /** Job ID */
  jobId: string
  /** Partial job data to update */
  data: Partial<Job>
}

// ============================================================
// ENGINEER PROFILE
// ============================================================

/** Update engineer profile */
export interface UpdateProfileRequest {
  /** Partial profile data to update */
  data: Partial<EngineerProfile>
}

// ============================================================
// GENERIC API RESPONSE WRAPPER
// ============================================================

/** Standard success response */
export interface ApiSuccessResponse<T> {
  success: true
  data: T
  /** Optional message */
  message?: string
}

/** Standard error response */
export interface ApiErrorResponse {
  success: false
  error: string
  /** Machine-readable error code */
  code: string
  /** HTTP status code */
  statusCode: number
  /** Field-level validation errors */
  fieldErrors?: Record<string, string>
  /** Retry after seconds (for rate limiting) */
  retryAfter?: number
}

/** Union type for all API responses */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse

// ============================================================
// OFFLINE SYNC
// ============================================================

/** Offline action queued in IndexedDB */
export interface OfflineAction {
  /** Unique action ID (UUID) */
  id: string
  /** Action type */
  type: 'CREATE_CIRCUIT' | 'UPDATE_CIRCUIT' | 'CREATE_OBSERVATION' | 'UPDATE_CERTIFICATE' | 'UPLOAD_PHOTO'
  /** Certificate ID this action belongs to */
  certificateId: string
  /** Action payload */
  payload: Record<string, unknown>
  /** Timestamp queued — ISO format */
  queuedAt: string
  /** Number of sync attempts */
  retryCount: number
  /** Last error message (if sync failed) */
  lastError?: string
}

/** Sync status response */
export interface SyncStatusResponse {
  /** Number of pending actions */
  pendingCount: number
  /** Last successful sync timestamp */
  lastSyncAt: string | null
  /** Whether currently syncing */
  isSyncing: boolean
}
