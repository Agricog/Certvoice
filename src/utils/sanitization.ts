/**
 * CertVoice — Input Sanitisation
 *
 * XSS protection using DOMPurify + custom sanitisation.
 * OWASP 2024: Never render unsanitised user input.
 *
 * Defence in depth:
 *   1. DOMPurify strips malicious HTML/JS
 *   2. escapeHtml (validation.ts) escapes special characters
 *   3. React's JSX auto-escapes text content
 *   4. CSP headers block inline scripts
 */

import DOMPurify from 'dompurify'

// ============================================================
// DOMPURIFY CONFIGURATION
// ============================================================

/** Strict config — strips ALL HTML. Use for form inputs. */
const STRICT_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
}

/** Minimal HTML config — allows basic formatting. Use for observation text. */
const MINIMAL_HTML_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br'],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
}

// ============================================================
// SANITISATION FUNCTIONS
// ============================================================

/**
 * Sanitise text input — strips ALL HTML tags and attributes.
 * Use for all standard form fields.
 *
 * @param input - Raw user input
 * @returns Sanitised string with no HTML
 */
export function sanitizeText(input: string): string {
  if (!input) return ''
  return DOMPurify.sanitize(input.trim(), STRICT_CONFIG)
}

/**
 * Sanitise observation text — allows minimal formatting (bold, italic, line breaks).
 * Use for observation descriptions and remarks.
 *
 * @param input - Raw observation text
 * @returns Sanitised string with minimal allowed HTML
 */
export function sanitizeObservationText(input: string): string {
  if (!input) return ''
  return DOMPurify.sanitize(input.trim(), MINIMAL_HTML_CONFIG)
}

/**
 * Sanitise a filename for upload.
 * Removes path traversal, special characters, and limits length.
 *
 * @param filename - Original filename
 * @returns Safe filename
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return 'unnamed'

  return filename
    // Remove path separators
    .replace(/[/\\]/g, '')
    // Remove special characters (keep alphanumeric, dots, hyphens, underscores)
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    // Collapse multiple underscores
    .replace(/_{2,}/g, '_')
    // Remove leading dots (hidden files)
    .replace(/^\.+/, '')
    // Limit length
    .substring(0, 100)
    // Ensure not empty after sanitisation
    || 'unnamed'
}

/**
 * Sanitise a URL — prevents javascript: and data: protocol attacks.
 * Only allows http: and https: protocols.
 *
 * @param url - URL string to validate
 * @returns Sanitised URL or empty string if invalid
 */
export function sanitizeUrl(url: string): string {
  if (!url) return ''

  const trimmed = url.trim()

  // Only allow http and https protocols
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return ''
    }
    return trimmed
  } catch {
    return ''
  }
}

/**
 * Sanitise transcript text from voice capture.
 * Preserves electrical terminology but strips any injected content.
 *
 * @param transcript - Raw voice transcript
 * @returns Sanitised transcript
 */
export function sanitizeTranscript(transcript: string): string {
  if (!transcript) return ''

  // Strip HTML
  let clean = DOMPurify.sanitize(transcript.trim(), STRICT_CONFIG)

  // Normalise whitespace (voice transcripts can have irregular spacing)
  clean = clean.replace(/\s+/g, ' ')

  return clean
}

/**
 * Sanitise a batch of key-value pairs.
 * Use when processing form data before submission.
 *
 * @param data - Object with string values
 * @returns Object with all values sanitised
 */
export function sanitizeFormData<T extends Record<string, string>>(
  data: T
): T {
  const sanitized = {} as Record<string, string>

  for (const [key, value] of Object.entries(data)) {
    sanitized[key] = sanitizeText(value)
  }

  return sanitized as T
}
