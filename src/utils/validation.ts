/**
 * CertVoice — Input Validation
 *
 * OWASP 2024 Compliant: Never trust user input.
 * Validate AND sanitise every field before processing.
 *
 * Includes CertVoice-specific validation for electrical measurements:
 * ohms, milliamps, kiloamps, voltage, megohms, etc.
 */

import type { ValidationResult, ValidationType, ValidationRule } from '../types/security'

// ============================================================
// REGEX PATTERNS
// ============================================================

const PATTERNS = {
  /** Standard email validation */
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /** UK postcode — covers all formats */
  postcode: /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i,
  /** UK phone number — landline or mobile */
  phone: /^(?:(?:\+44\s?|0)(?:\d\s?){9,10})$/,
  /** Currency — up to 2 decimal places */
  currency: /^\d+(\.\d{1,2})?$/,
  /** Positive number with up to 3 decimal places (for ohms, etc.) */
  measurement: /^\d+(\.\d{1,3})?$/,
  /** Positive integer */
  integer: /^\d+$/,
  /** Percentage 0-100 with optional decimal */
  percentage: /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/,
  /** Dangerous characters for XSS prevention */
  dangerousChars: /[<>"'`\\]/g,
} as const

// ============================================================
// CORE VALIDATION FUNCTION
// ============================================================

/**
 * Validate and sanitise a single input value.
 *
 * @param input - Raw user input string
 * @param type - Validation type to apply
 * @param maxLength - Maximum allowed character length (default 255)
 * @returns ValidationResult with isValid, errors, and sanitised value
 */
export function validateInput(
  input: string,
  type: ValidationType,
  maxLength: number = 255
): ValidationResult {
  const errors: Record<string, string> = {}
  let sanitized = input.trim()

  // --- Length check ---
  if (sanitized.length > maxLength) {
    errors.length = `Maximum ${maxLength} characters allowed`
  }

  // --- Type-specific validation ---
  switch (type) {
    case 'email':
      if (sanitized && !PATTERNS.email.test(sanitized)) {
        errors.format = 'Invalid email format'
      }
      break

    case 'number':
      if (sanitized && isNaN(Number(sanitized))) {
        errors.format = 'Must be a valid number'
      }
      break

    case 'currency':
      if (sanitized && !PATTERNS.currency.test(sanitized)) {
        errors.format = 'Invalid currency format (e.g. 29.50)'
      }
      break

    case 'postcode':
      if (sanitized && !PATTERNS.postcode.test(sanitized)) {
        errors.format = 'Invalid UK postcode'
      }
      break

    case 'phone':
      if (sanitized && !PATTERNS.phone.test(sanitized.replace(/\s/g, ''))) {
        errors.format = 'Invalid UK phone number'
      }
      break

    case 'ohms':
      if (sanitized && !PATTERNS.measurement.test(sanitized)) {
        errors.format = 'Invalid resistance value (e.g. 0.42)'
      } else if (sanitized && Number(sanitized) < 0) {
        errors.range = 'Resistance cannot be negative'
      }
      break

    case 'milliamps':
      if (sanitized && !PATTERNS.measurement.test(sanitized)) {
        errors.format = 'Invalid milliamp value (e.g. 30)'
      } else if (sanitized && Number(sanitized) < 0) {
        errors.range = 'Current cannot be negative'
      }
      break

    case 'kiloamps':
      if (sanitized && !PATTERNS.measurement.test(sanitized)) {
        errors.format = 'Invalid kA value (e.g. 1.6)'
      } else if (sanitized && Number(sanitized) < 0) {
        errors.range = 'Fault current cannot be negative'
      }
      break

    case 'voltage':
      if (sanitized && !PATTERNS.measurement.test(sanitized)) {
        errors.format = 'Invalid voltage value (e.g. 230)'
      } else if (sanitized && Number(sanitized) < 0) {
        errors.range = 'Voltage cannot be negative'
      }
      break

    case 'temperature':
      if (sanitized && isNaN(Number(sanitized))) {
        errors.format = 'Invalid temperature value'
      }
      break

    case 'percentage':
      if (sanitized && !PATTERNS.percentage.test(sanitized)) {
        errors.format = 'Must be a percentage between 0 and 100'
      }
      break

    case 'text':
    default:
      // Text just gets length + XSS checks (handled below)
      break
  }

  // --- XSS Protection: Escape dangerous characters ---
  sanitized = escapeHtml(sanitized)

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized,
  }
}

// ============================================================
// RULE-BASED VALIDATION
// ============================================================

/**
 * Validate a value against a full ValidationRule config.
 * Used for form fields with min/max/required constraints.
 */
export function validateWithRule(
  input: string,
  rule: ValidationRule
): ValidationResult {
  const errors: Record<string, string> = {}
  const trimmed = input.trim()

  // Required check
  if (rule.required && !trimmed) {
    errors.required = rule.message ?? 'This field is required'
    return { isValid: false, errors, sanitized: trimmed }
  }

  // Skip further validation if empty and not required
  if (!trimmed) {
    return { isValid: true, errors, sanitized: trimmed }
  }

  // Run standard type validation
  const typeResult = validateInput(trimmed, rule.type, rule.maxLength)
  if (!typeResult.isValid) {
    return typeResult
  }

  // Min/max range checks for numeric types
  const numericTypes: ValidationType[] = [
    'number', 'currency', 'ohms', 'milliamps',
    'kiloamps', 'voltage', 'temperature', 'percentage',
  ]

  if (numericTypes.includes(rule.type)) {
    const numValue = Number(trimmed)
    if (rule.min !== undefined && numValue < rule.min) {
      errors.min = rule.message ?? `Minimum value is ${rule.min}`
    }
    if (rule.max !== undefined && numValue > rule.max) {
      errors.max = rule.message ?? `Maximum value is ${rule.max}`
    }
  }

  // Custom regex pattern
  if (rule.pattern && !rule.pattern.test(trimmed)) {
    errors.pattern = rule.message ?? 'Invalid format'
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized: typeResult.sanitized,
  }
}

// ============================================================
// CERTVOICE-SPECIFIC VALIDATORS
// ============================================================

/**
 * Validate a test value that can be a number, '>200', 'LIM', or 'N/V'.
 * Used for insulation resistance and continuity readings.
 */
export function validateTestValue(input: string): {
  isValid: boolean
  value: number | '>200' | 'LIM' | 'N/V' | null
  error?: string
} {
  const trimmed = input.trim().toUpperCase()

  // Special values
  if (trimmed === '>200' || trimmed === '> 200' || trimmed === 'GREATER THAN 200') {
    return { isValid: true, value: '>200' }
  }
  if (trimmed === 'LIM' || trimmed === 'LIMITATION') {
    return { isValid: true, value: 'LIM' }
  }
  if (trimmed === 'N/V' || trimmed === 'NV' || trimmed === 'NOT VERIFIED') {
    return { isValid: true, value: 'N/V' }
  }

  // Numeric value
  const num = Number(trimmed)
  if (!isNaN(num) && num >= 0) {
    return { isValid: true, value: num }
  }

  return {
    isValid: false,
    value: null,
    error: 'Enter a number, >200, LIM, or N/V',
  }
}

/**
 * Validate a circuit number (Column 1).
 * Can be numeric or include phase designation (e.g. '3', '3 L1', 'TP').
 */
export function validateCircuitNumber(input: string): {
  isValid: boolean
  error?: string
} {
  const trimmed = input.trim()
  if (!trimmed) {
    return { isValid: false, error: 'Circuit number is required' }
  }
  if (trimmed.length > 10) {
    return { isValid: false, error: 'Circuit number too long' }
  }
  // Allow digits, letters, spaces, and forward slashes
  if (!/^[\w\s/]+$/.test(trimmed)) {
    return { isValid: false, error: 'Invalid circuit number format' }
  }
  return { isValid: true }
}

/**
 * Validate Zs against max permitted Zs (Col 26 vs Col 12).
 * Returns warning if measured exceeds maximum.
 */
export function validateZs(
  measuredZs: number,
  maxPermittedZs: number | null
): {
  isValid: boolean
  warning?: string
} {
  if (maxPermittedZs === null) {
    return { isValid: true }
  }
  if (measuredZs > maxPermittedZs) {
    return {
      isValid: false,
      warning: `Zs ${measuredZs}Ω exceeds max permitted ${maxPermittedZs}Ω. Consider C2 classification.`,
    }
  }
  return { isValid: true }
}

/**
 * Validate insulation resistance minimum (Cols 24, 25).
 * Must be >= 1.0 MΩ (or >= 0.5 MΩ for FELV).
 */
export function validateInsulationResistance(
  value: number,
  isFelv: boolean = false
): {
  isValid: boolean
  warning?: string
} {
  const minimum = isFelv ? 0.5 : 1.0
  if (value < minimum) {
    return {
      isValid: false,
      warning: `IR ${value}MΩ below minimum ${minimum}MΩ. Consider FI classification.`,
    }
  }
  return { isValid: true }
}

/**
 * Validate RCD disconnection time (Col 28).
 * Must be <= 300ms at IΔn (or <= 40ms for Type S at 5x).
 */
export function validateRcdTime(
  timeMs: number,
  rcdType?: string
): {
  isValid: boolean
  warning?: string
} {
  const maxTime = rcdType === 'S' ? 40 : 300
  if (timeMs > maxTime) {
    return {
      isValid: false,
      warning: `RCD time ${timeMs}ms exceeds max ${maxTime}ms. Circuit may not be adequately protected.`,
    }
  }
  return { isValid: true }
}

/**
 * Validate ring final continuity — r1 should approximately equal rn (Cols 17, 18).
 * Warning if difference exceeds 0.05Ω.
 */
export function validateRingContinuity(
  r1: number,
  rn: number
): {
  isValid: boolean
  warning?: string
} {
  const difference = Math.abs(r1 - rn)
  if (difference > 0.05) {
    return {
      isValid: false,
      warning: `r1 (${r1}Ω) and rn (${rn}Ω) differ by ${difference.toFixed(3)}Ω. Possible interconnection.`,
    }
  }
  return { isValid: true }
}

// ============================================================
// HTML ESCAPE UTILITY
// ============================================================

/**
 * Escape HTML entities to prevent XSS.
 * Defence in depth — used alongside DOMPurify.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
}
