/**
 * CertVoice — Analytics (Google Analytics 4)
 *
 * Non-PII event tracking only.
 * NEVER send: names, addresses, emails, phone numbers, certificate content.
 * ONLY send: event names, counts, categories, timestamps, durations.
 */

// ============================================================
// GA4 TYPES
// ============================================================

/** GA4 event parameters — all non-PII */
interface GAEventParams {
  [key: string]: string | number | boolean | undefined
}

// ============================================================
// CORE TRACKING FUNCTION
// ============================================================

/**
 * Send a GA4 event. Safe no-op if GA4 is not loaded.
 *
 * @param eventName - GA4 event name (snake_case)
 * @param params - Non-PII event parameters
 */
function trackEvent(eventName: string, params?: GAEventParams): void {
  try {
    if (typeof window !== 'undefined' && 'gtag' in window) {
      const gtag = (window as unknown as Record<string, (...args: unknown[]) => void>).gtag
      gtag('event', eventName, {
        ...params,
        timestamp: new Date().toISOString(),
      })
    }
  } catch {
    // Silent fail — analytics should never break the app
  }
}

// ============================================================
// PAGE VIEW TRACKING
// ============================================================

/**
 * Track a page view. Called on route changes.
 */
export function trackPageView(pagePath: string, pageTitle: string): void {
  trackEvent('page_view', {
    page_path: pagePath,
    page_title: pageTitle,
  })
}

// ============================================================
// VOICE CAPTURE EVENTS
// ============================================================

/**
 * Track when voice recording starts.
 */
export function trackVoiceStart(location: string): void {
  trackEvent('voice_capture_start', {
    capture_location: location,
  })
}

/**
 * Track when voice recording stops and transcript is ready.
 */
export function trackVoiceComplete(
  durationMs: number,
  transcriptLength: number
): void {
  trackEvent('voice_capture_complete', {
    duration_ms: durationMs,
    transcript_length: transcriptLength,
  })
}

/**
 * Track voice capture errors (e.g. microphone denied, no speech detected).
 */
export function trackVoiceError(errorType: string): void {
  trackEvent('voice_capture_error', {
    error_type: errorType,
  })
}

// ============================================================
// AI EXTRACTION EVENTS
// ============================================================

/**
 * Track a successful AI extraction.
 */
export function trackAIExtraction(
  extractionType: string,
  confidence: number,
  fieldCount: number,
  durationMs: number
): void {
  trackEvent('ai_extraction_success', {
    extraction_type: extractionType,
    confidence_score: Math.round(confidence * 100),
    fields_extracted: fieldCount,
    duration_ms: durationMs,
  })
}

/**
 * Track an AI extraction failure.
 */
export function trackAIExtractionError(
  extractionType: string,
  errorCode: string
): void {
  trackEvent('ai_extraction_error', {
    extraction_type: extractionType,
    error_code: errorCode,
  })
}

// ============================================================
// CERTIFICATE EVENTS
// ============================================================

/**
 * Track certificate creation.
 */
export function trackCertificateCreated(premisesType: string): void {
  trackEvent('certificate_created', {
    premises_type: premisesType,
  })
}

/**
 * Track certificate completion (all sections filled).
 */
export function trackCertificateCompleted(
  circuitCount: number,
  observationCount: number,
  durationMinutes: number
): void {
  trackEvent('certificate_completed', {
    circuit_count: circuitCount,
    observation_count: observationCount,
    duration_minutes: durationMinutes,
  })
}

/**
 * Track PDF generation.
 */
export function trackPDFGenerated(pageCount: number): void {
  trackEvent('pdf_generated', {
    page_count: pageCount,
  })
}

/**
 * Track PDF download or share.
 */
export function trackPDFShared(method: 'download' | 'email'): void {
  trackEvent('pdf_shared', {
    share_method: method,
  })
}

// ============================================================
// INSPECTION EVENTS
// ============================================================

/**
 * Track circuit test results capture.
 */
export function trackCircuitCaptured(
  circuitType: string,
  captureMethod: 'voice' | 'manual'
): void {
  trackEvent('circuit_captured', {
    circuit_type: circuitType,
    capture_method: captureMethod,
  })
}

/**
 * Track observation/defect capture.
 */
export function trackObservationCaptured(
  classificationCode: string,
  hasPhoto: boolean
): void {
  trackEvent('observation_captured', {
    classification_code: classificationCode,
    has_photo: hasPhoto,
  })
}

/**
 * Track inspection checklist progress.
 */
export function trackChecklistProgress(
  completedItems: number,
  totalItems: number
): void {
  trackEvent('checklist_progress', {
    completed_items: completedItems,
    total_items: totalItems,
    completion_percent: Math.round((completedItems / totalItems) * 100),
  })
}

// ============================================================
// OFFLINE / SYNC EVENTS
// ============================================================

/**
 * Track when app goes offline.
 */
export function trackOffline(): void {
  trackEvent('app_offline')
}

/**
 * Track when app comes back online.
 */
export function trackOnline(pendingSyncCount: number): void {
  trackEvent('app_online', {
    pending_sync_count: pendingSyncCount,
  })
}

/**
 * Track successful offline sync.
 */
export function trackSyncComplete(syncedCount: number): void {
  trackEvent('sync_complete', {
    synced_count: syncedCount,
  })
}

// ============================================================
// USER FLOW EVENTS
// ============================================================

/**
 * Track subscription conversion.
 */
export function trackSubscriptionStarted(plan: string): void {
  trackEvent('subscription_started', {
    plan_type: plan,
  })
}

/**
 * Track feature usage for product analytics.
 */
export function trackFeatureUsed(
  feature: 'voice_capture' | 'photo_evidence' | 'bluetooth_instrument' | 'manual_entry' | 'checklist'
): void {
  trackEvent('feature_used', {
    feature_name: feature,
  })
}
