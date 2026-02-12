/**
 * CertVoice — Security Types
 *
 * Types for authentication, CSRF, session management, rate limiting,
 * and input validation. Per OWASP 2024 + Autaimate Build Standard v2.
 */

// ============================================================
// INPUT VALIDATION
// ============================================================

/** Result of input validation */
export interface ValidationResult {
  /** Whether the input passed validation */
  isValid: boolean
  /** Field-level error messages */
  errors: Record<string, string>
  /** Sanitised version of the input */
  sanitized: string
}

/** Supported input validation types */
export type ValidationType =
  | 'email'
  | 'number'
  | 'text'
  | 'currency'
  | 'postcode'
  | 'phone'
  | 'ohms'
  | 'milliamps'
  | 'kiloamps'
  | 'voltage'
  | 'temperature'
  | 'percentage'

/** Validation rule configuration */
export interface ValidationRule {
  /** Validation type */
  type: ValidationType
  /** Whether the field is required */
  required: boolean
  /** Maximum character length */
  maxLength: number
  /** Minimum value (for numbers) */
  min?: number
  /** Maximum value (for numbers) */
  max?: number
  /** Custom regex pattern */
  pattern?: RegExp
  /** Custom error message */
  message?: string
}

// ============================================================
// CSRF PROTECTION
// ============================================================

/** CSRF token response from server */
export interface CSRFTokenResponse {
  /** CSRF token string */
  token: string
  /** Token expiry timestamp — ISO format */
  expiresAt: string
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

/** Session configuration */
export interface SessionConfig {
  /** Absolute session timeout in milliseconds */
  sessionTimeout: number
  /** Idle timeout in milliseconds */
  idleTimeout: number
  /** Events that reset the idle timer */
  activityEvents: string[]
}

/** Session state */
export interface SessionState {
  /** Whether user is authenticated */
  isAuthenticated: boolean
  /** Time remaining before session expires in ms */
  timeRemaining: number
  /** Whether idle warning is showing */
  showIdleWarning: boolean
  /** Last activity timestamp — ISO format */
  lastActivity: string
}

// ============================================================
// RATE LIMITING
// ============================================================

/** Rate limit status from API response headers */
export interface RateLimitStatus {
  /** Maximum requests allowed in window */
  limit: number
  /** Requests remaining in current window */
  remaining: number
  /** Window reset timestamp — ISO format */
  reset: string
  /** Whether rate limit has been exceeded */
  exceeded: boolean
  /** Seconds until retry is allowed (if exceeded) */
  retryAfter?: number
}

/** Rate limit configuration per endpoint */
export interface RateLimitConfig {
  /** Endpoint pattern */
  endpoint: string
  /** Max requests per window */
  maxRequests: number
  /** Window duration in seconds */
  windowSeconds: number
}

/** CertVoice rate limit rules */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  /** AI extraction — 60 calls per hour per user (prevent API cost abuse) */
  aiExtraction: {
    endpoint: '/api/extract',
    maxRequests: 60,
    windowSeconds: 3600,
  },
  /** PDF generation — 20 per hour */
  pdfGeneration: {
    endpoint: '/api/pdf/generate',
    maxRequests: 20,
    windowSeconds: 3600,
  },
  /** File upload — 100 per hour */
  fileUpload: {
    endpoint: '/api/upload-url',
    maxRequests: 100,
    windowSeconds: 3600,
  },
  /** General API — 300 per minute */
  generalApi: {
    endpoint: '/api/*',
    maxRequests: 300,
    windowSeconds: 60,
  },
} as const

// ============================================================
// AUTHENTICATION (Clerk)
// ============================================================

/** Authenticated user context */
export interface AuthUser {
  /** Clerk user ID */
  userId: string
  /** User email */
  email: string
  /** User full name */
  fullName: string
  /** Whether MFA is enabled */
  mfaEnabled: boolean
  /** Session ID */
  sessionId: string
  /** Session created timestamp */
  sessionCreatedAt: string
}

/** User role within the app */
export type UserRole = 'INSPECTOR' | 'SUPERVISOR' | 'ADMIN'

/** Permission check result */
export interface PermissionCheck {
  /** Whether action is allowed */
  allowed: boolean
  /** Reason if denied */
  reason?: string
}

// ============================================================
// FILE UPLOAD SECURITY
// ============================================================

/** Allowed file types per upload category */
export interface FileConstraints {
  /** Maximum file size in bytes */
  maxSize: number
  /** Allowed MIME types */
  allowedTypes: readonly string[]
  /** Allowed file extensions */
  allowedExtensions: readonly string[]
}

/** File validation result */
export interface FileValidationResult {
  /** Whether the file passed validation */
  valid: boolean
  /** Error message if invalid */
  error?: string
}

/** CertVoice file upload constraints */
export const FILE_CONSTRAINTS: Record<string, FileConstraints> = {
  /** Photo evidence — JPEG/PNG up to 10MB */
  photoEvidence: {
    maxSize: 10 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  },
  /** Digital signature — PNG up to 2MB */
  signature: {
    maxSize: 2 * 1024 * 1024,
    allowedTypes: ['image/png'],
    allowedExtensions: ['.png'],
  },
  /** Company logo — JPEG/PNG/SVG up to 5MB */
  companyLogo: {
    maxSize: 5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/svg+xml'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.svg'],
  },
} as const

// ============================================================
// SECURITY HEADERS
// ============================================================

/** Expected security headers (verified client-side for defence in depth) */
export const EXPECTED_SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
} as const

// ============================================================
// ERROR TRACKING (Sentry)
// ============================================================

/** Error context for Sentry reporting */
export interface ErrorContext {
  /** Error category */
  type:
    | 'voice_capture'
    | 'ai_extraction'
    | 'pdf_generation'
    | 'file_upload'
    | 'certificate_save'
    | 'offline_sync'
    | 'authentication'
    | 'validation'
    | 'unknown'
  /** Component or function where error occurred */
  context: string
  /** Non-PII metadata */
  metadata?: Record<string, string | number | boolean>
}
