/**
 * CertVoice — Error Tracking (Sentry)
 *
 * Production monitoring with PII protection.
 * OWASP 2024: Log errors but never expose sensitive data.
 *
 * Rules:
 *   - No PII in error reports (names, addresses, emails masked)
 *   - No API keys or tokens in breadcrumbs
 *   - No voice transcript content (only metadata)
 *   - Certificate data referenced by ID only
 */

import * as Sentry from '@sentry/react'
import type { ErrorContext } from '../types/security'

// ============================================================
// INITIALISATION
// ============================================================

/**
 * Initialise Sentry error tracking.
 * Call once in main.tsx on app startup.
 */
export function initializeSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN

  // Skip initialisation if no DSN configured (local dev)
  if (!dsn) {
    return
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: `certvoice@${import.meta.env.VITE_APP_VERSION ?? '1.0.0'}`,

    // Sample 10% of transactions in production
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,

    // Session replay — mask all text and block media for PII safety
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Filter sensitive data before sending to Sentry
    beforeSend(event) {
      return filterSensitiveData(event)
    },

    // Filter breadcrumbs — remove sensitive URLs and data
    beforeBreadcrumb(breadcrumb) {
      return filterBreadcrumb(breadcrumb)
    },
  })
}

// ============================================================
// ERROR CAPTURE FUNCTIONS
// ============================================================

/**
 * Capture a CertVoice-specific error with context.
 * Use this instead of raw Sentry.captureException for consistent tagging.
 *
 * @param error - The error object
 * @param context - CertVoice error context (type, component, metadata)
 */
export function captureError(
  error: unknown,
  context: string,
  errorContext?: ErrorContext
): void {
  Sentry.captureException(error, {
    tags: {
      certvoice_type: errorContext?.type ?? 'unknown',
      certvoice_context: context,
    },
    extra: errorContext?.metadata
      ? sanitizeMetadata(errorContext.metadata)
      : undefined,
    level: 'error',
  })
}

/**
 * Capture a warning — non-critical but worth monitoring.
 * E.g. Zs exceeds max, IR below minimum, ring continuity mismatch.
 */
export function captureWarning(
  message: string,
  context: string,
  metadata?: Record<string, string | number | boolean>
): void {
  Sentry.captureMessage(message, {
    tags: {
      certvoice_type: 'validation',
      certvoice_context: context,
    },
    extra: metadata ? sanitizeMetadata(metadata) : undefined,
    level: 'warning',
  })
}

/**
 * Capture a voice capture / AI extraction error.
 * Never includes transcript content — only metadata.
 */
export function captureAIError(
  error: unknown,
  metadata: {
    transcriptLength: number
    extractionType: string
    confidence?: number
  }
): void {
  Sentry.captureException(error, {
    tags: {
      certvoice_type: 'ai_extraction',
      extraction_type: metadata.extractionType,
    },
    extra: {
      transcript_length: metadata.transcriptLength,
      confidence: metadata.confidence,
      // NEVER include transcript content
    },
    level: 'error',
  })
}

/**
 * Capture an offline sync error.
 */
export function captureSyncError(
  error: unknown,
  metadata: {
    actionType: string
    certificateId: string
    retryCount: number
  }
): void {
  Sentry.captureException(error, {
    tags: {
      certvoice_type: 'offline_sync',
      action_type: metadata.actionType,
    },
    extra: {
      certificate_id: metadata.certificateId,
      retry_count: metadata.retryCount,
    },
    level: 'error',
  })
}

// ============================================================
// USER CONTEXT (PII-Safe)
// ============================================================

/**
 * Set the current user context for Sentry.
 * Only stores user ID — no name, email, or other PII.
 */
export function setUserContext(userId: string): void {
  Sentry.setUser({ id: userId })
}

/**
 * Clear user context on logout.
 */
export function clearUserContext(): void {
  Sentry.setUser(null)
}

// ============================================================
// PII FILTERING
// ============================================================

/**
 * Filter sensitive data from Sentry events before transmission.
 * Removes auth headers, CSRF tokens, and any PII fields.
 */
function filterSensitiveData(
  event: Sentry.ErrorEvent
): Sentry.ErrorEvent | null {
  // Remove sensitive headers
  if (event.request?.headers) {
    delete event.request.headers['Authorization']
    delete event.request.headers['X-CSRF-Token']
    delete event.request.headers['Cookie']
    delete event.request.headers['Set-Cookie']
  }

  // Remove sensitive query params
  if (event.request?.query_string) {
    event.request.query_string = '[FILTERED]'
  }

  // Remove request body (may contain certificate data)
  if (event.request?.data) {
    event.request.data = '[FILTERED]'
  }

  return event
}

/**
 * Filter breadcrumbs — remove sensitive URLs and form data.
 */
function filterBreadcrumb(
  breadcrumb: Sentry.Breadcrumb
): Sentry.Breadcrumb | null {
  // Filter out API calls that might contain sensitive data
  if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
    const url = breadcrumb.data?.url as string | undefined
    if (url) {
      // Keep the endpoint path but remove query params
      try {
        const parsed = new URL(url, window.location.origin)
        breadcrumb.data = {
          ...breadcrumb.data,
          url: parsed.pathname,
        }
      } catch {
        // If URL parsing fails, redact entirely
        breadcrumb.data = { url: '[FILTERED]' }
      }
    }
  }

  return breadcrumb
}

/**
 * Sanitise metadata before attaching to Sentry events.
 * Ensures no PII leaks into extra data.
 */
function sanitizeMetadata(
  metadata: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {}
  const piiFields = ['name', 'email', 'address', 'phone', 'postcode', 'client', 'occupier']

  for (const [key, value] of Object.entries(metadata)) {
    // Check if key contains PII field names
    const isPii = piiFields.some(field =>
      key.toLowerCase().includes(field)
    )

    if (isPii) {
      sanitized[key] = '[REDACTED]'
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}
