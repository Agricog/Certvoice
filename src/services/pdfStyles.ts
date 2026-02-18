/**
 * CertVoice — PDF Styles & Drawing Helpers
 *
 * Shared constants and utility functions for EICR PDF generation.
 * All measurements in PDF points (1 point = 1/72 inch).
 * A4 = 595.28 x 841.89 points.
 *
 * Design: professional dark-header style matching CertVoice brand,
 * fully original layout (no IET model forms used).
 *
 * @module services/pdfStyles
 */
import { rgb, type PDFPage, type PDFFont, type Color } from 'pdf-lib'

// ============================================================
// PAGE DIMENSIONS (A4)
// ============================================================

export const PAGE = {
  width: 595.28,
  height: 841.89,
  marginLeft: 40,
  marginRight: 40,
  marginTop: 40,
  marginBottom: 50,
} as const

/** Usable content width */
export const CONTENT_WIDTH = PAGE.width - PAGE.marginLeft - PAGE.marginRight

// ============================================================
// COLOURS
// ============================================================

export const COLOURS = {
  // Text
  text: rgb(0.13, 0.13, 0.15),
  muted: rgb(0.42, 0.42, 0.48),
  label: rgb(0.35, 0.35, 0.4),

  // Backgrounds
  white: rgb(1, 1, 1),
  rowAlt: rgb(0.96, 0.96, 0.97),
  fieldBg: rgb(0.97, 0.97, 0.98),
  headerBg: rgb(0.12, 0.14, 0.18),
  sectionBg: rgb(0.2, 0.23, 0.28),

  // UI / brand
  accent: rgb(0.24, 0.47, 0.96),
  accentLight: rgb(0.24, 0.47, 0.96),
  border: rgb(0.82, 0.82, 0.85),
  borderLight: rgb(0.88, 0.88, 0.9),

  // Classification codes
  c1: rgb(0.85, 0.15, 0.15),
  c2: rgb(0.88, 0.55, 0.05),
  c3: rgb(0.14, 0.6, 0.25),
  fi: rgb(0.24, 0.47, 0.96),

  // Status
  pass: rgb(0.14, 0.6, 0.25),
  fail: rgb(0.85, 0.15, 0.15),
} as const

// ============================================================
// FONT SIZES
// ============================================================

export const FONT = {
  title: 16,
  sectionHeader: 9,
  label: 7,
  value: 8,
  tableHeader: 6,
  tableBody: 6.5,
  small: 5.5,
  pageNumber: 7,
  reportNumber: 8,
} as const

// ============================================================
// SPACING
// ============================================================

export const SPACING = {
  sectionGap: 12,
  fieldRowGap: 14,
  sectionHeaderHeight: 18,
  fieldRowHeight: 13,
  sectionHeaderPadding: 5,
  tableHeaderHeight: 14,
  tableRowHeight: 12,
  pageHeaderHeight: 46,
  lineHeight: 1.3,
} as const

// ============================================================
// DRAWING HELPERS
// ============================================================

/**
 * Draw a section header bar with white uppercase text.
 * Returns the new Y position below the header.
 */
export function drawSectionHeader(
  page: PDFPage,
  fontBold: PDFFont,
  y: number,
  label: string,
): number {
  // Background bar
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - SPACING.sectionHeaderHeight,
    width: CONTENT_WIDTH,
    height: SPACING.sectionHeaderHeight,
    color: COLOURS.sectionBg,
  })

  // Accent left edge
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - SPACING.sectionHeaderHeight,
    width: 3,
    height: SPACING.sectionHeaderHeight,
    color: COLOURS.accent,
  })

  page.drawText(label.toUpperCase(), {
    x: PAGE.marginLeft + 8,
    y: y - SPACING.sectionHeaderHeight + SPACING.sectionHeaderPadding,
    size: FONT.sectionHeader,
    font: fontBold,
    color: COLOURS.white,
  })

  return y - SPACING.sectionHeaderHeight - 6
}

/**
 * Draw a single label + value field on one line.
 * Value is truncated if it exceeds available width.
 */
export function drawField(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  y: number,
  label: string,
  value: string,
  options?: {
    x?: number
    maxWidth?: number
    labelWidth?: number
    valueColour?: Color
  },
): number {
  const x = options?.x ?? PAGE.marginLeft
  const labelWidth = options?.labelWidth ?? 130
  const maxWidth = options?.maxWidth ?? (PAGE.width - PAGE.marginRight - x - labelWidth)
  const valueColour = options?.valueColour ?? COLOURS.text

  page.drawText(label, {
    x,
    y,
    size: FONT.label,
    font,
    color: COLOURS.label,
  })

  // Truncate value if it overflows
  let displayValue = value || '—'
  const valueX = x + labelWidth
  while (
    displayValue.length > 1 &&
    fontBold.widthOfTextAtSize(displayValue, FONT.value) > maxWidth
  ) {
    displayValue = displayValue.slice(0, -1)
  }
  if (displayValue.length < (value || '—').length && displayValue.length > 2) {
    displayValue = displayValue.slice(0, -1) + '…'
  }

  page.drawText(displayValue, {
    x: valueX,
    y,
    size: FONT.value,
    font: fontBold,
    color: valueColour,
  })

  return y - SPACING.fieldRowGap
}

/**
 * Draw a field whose value may wrap across multiple lines.
 * Returns the Y position after the last line.
 */
export function drawWrappedField(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  y: number,
  label: string,
  value: string,
  options?: {
    x?: number
    labelWidth?: number
    valueColour?: Color
  },
): number {
  const x = options?.x ?? PAGE.marginLeft
  const labelWidth = options?.labelWidth ?? 130
  const valueColour = options?.valueColour ?? COLOURS.text
  const valueX = x + labelWidth
  const maxValueWidth = PAGE.width - PAGE.marginRight - valueX - 4

  // Draw label on the first line
  page.drawText(label, {
    x,
    y,
    size: FONT.label,
    font,
    color: COLOURS.label,
  })

  const displayValue = value || '—'
  const lines = wrapText(displayValue, fontBold, FONT.value, maxValueWidth)

  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i], {
      x: valueX,
      y: y - i * 10,
      size: FONT.value,
      font: fontBold,
      color: valueColour,
    })
  }

  // Advance Y by the number of lines used
  const totalHeight = Math.max(lines.length * 10, SPACING.fieldRowGap)
  return y - totalHeight
}

/**
 * Draw two fields side by side on one row.
 */
export function drawFieldPair(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  y: number,
  field1: { label: string; value: string },
  field2: { label: string; value: string },
): number {
  const halfWidth = CONTENT_WIDTH / 2
  const labelWidth = 110

  drawField(page, font, fontBold, y, field1.label, field1.value, {
    x: PAGE.marginLeft,
    labelWidth,
    maxWidth: halfWidth - labelWidth - 8,
  })

  drawField(page, font, fontBold, y, field2.label, field2.value, {
    x: PAGE.marginLeft + halfWidth,
    labelWidth,
    maxWidth: halfWidth - labelWidth - 8,
  })

  return y - SPACING.fieldRowGap
}

/**
 * Draw a thin horizontal rule across the content area.
 */
export function drawHorizontalRule(
  page: PDFPage,
  y: number,
  colour?: Color,
): void {
  page.drawLine({
    start: { x: PAGE.marginLeft, y },
    end: { x: PAGE.width - PAGE.marginRight, y },
    thickness: 0.5,
    color: colour ?? COLOURS.border,
  })
}

/**
 * Draw a table header row with white text on dark background.
 */
export function drawTableHeader(
  page: PDFPage,
  fontBold: PDFFont,
  y: number,
  columns: { label: string; width: number; align?: 'left' | 'center' | 'right' }[],
): number {
  const rowY = y - SPACING.tableHeaderHeight

  page.drawRectangle({
    x: PAGE.marginLeft,
    y: rowY,
    width: CONTENT_WIDTH,
    height: SPACING.tableHeaderHeight,
    color: COLOURS.sectionBg,
  })

  let colX = PAGE.marginLeft
  for (const col of columns) {
    const textWidth = fontBold.widthOfTextAtSize(col.label, FONT.tableHeader)
    let textX = colX + 3
    if (col.align === 'center') {
      textX = colX + (col.width - textWidth) / 2
    } else if (col.align === 'right') {
      textX = colX + col.width - textWidth - 3
    }
    page.drawText(col.label, {
      x: textX,
      y: rowY + 4,
      size: FONT.tableHeader,
      font: fontBold,
      color: COLOURS.white,
    })
    colX += col.width
  }

  return rowY
}

/**
 * Draw a single table data row with optional alternating background.
 */
export function drawTableRow(
  page: PDFPage,
  font: PDFFont,
  y: number,
  columns: { width: number; align?: 'left' | 'center' | 'right' }[],
  values: string[],
  options?: {
    isAlt?: boolean
    textColour?: Color
    rowHeight?: number
  },
): number {
  const rowHeight = options?.rowHeight ?? SPACING.tableRowHeight
  const rowY = y - rowHeight

  if (options?.isAlt) {
    page.drawRectangle({
      x: PAGE.marginLeft,
      y: rowY,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: COLOURS.rowAlt,
    })
  }

  // Bottom border
  page.drawLine({
    start: { x: PAGE.marginLeft, y: rowY },
    end: { x: PAGE.width - PAGE.marginRight, y: rowY },
    thickness: 0.3,
    color: COLOURS.borderLight,
  })

  let colX = PAGE.marginLeft
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    if (!col) continue
    const text = values[i] ?? ''

    // Truncate with ellipsis
    let displayText = text
    const maxTextWidth = col.width - 6
    while (
      displayText.length > 0 &&
      font.widthOfTextAtSize(displayText, FONT.tableBody) > maxTextWidth
    ) {
      displayText = displayText.slice(0, -1)
    }
    if (displayText.length < text.length && displayText.length > 2) {
      displayText = displayText.slice(0, -1) + '…'
    }

    const textWidth = font.widthOfTextAtSize(displayText, FONT.tableBody)
    let textX = colX + 3
    if (col.align === 'center') {
      textX = colX + (col.width - textWidth) / 2
    } else if (col.align === 'right') {
      textX = colX + col.width - textWidth - 3
    }

    page.drawText(displayText, {
      x: textX,
      y: rowY + 3,
      size: FONT.tableBody,
      font,
      color: options?.textColour ?? COLOURS.text,
    })

    colX += col.width
  }

  return rowY
}

/**
 * Draw a coloured table cell (overwrites existing cell content).
 * Used for classification code badges in observation tables.
 */
export function drawCodeBadge(
  page: PDFPage,
  fontBold: PDFFont,
  x: number,
  y: number,
  width: number,
  rowHeight: number,
  code: string,
  colour: Color,
): void {
  // Clear cell background
  page.drawRectangle({
    x,
    y,
    width,
    height: rowHeight,
    color: COLOURS.white,
  })

  const textWidth = fontBold.widthOfTextAtSize(code, FONT.tableBody)
  page.drawText(code, {
    x: x + (width - textWidth) / 2,
    y: y + 3,
    size: FONT.tableBody,
    font: fontBold,
    color: colour,
  })
}

/**
 * Draw the page footer with CertVoice branding.
 */
export function drawPageFooter(
  page: PDFPage,
  font: PDFFont,
): void {
  const y = PAGE.marginBottom - 20
  const text = 'Generated by CertVoice — certvoice.co.uk'
  const textWidth = font.widthOfTextAtSize(text, FONT.small)

  // Thin rule above footer
  page.drawLine({
    start: { x: PAGE.marginLeft, y: y + 10 },
    end: { x: PAGE.width - PAGE.marginRight, y: y + 10 },
    thickness: 0.3,
    color: COLOURS.borderLight,
  })

  page.drawText(text, {
    x: (PAGE.width - textWidth) / 2,
    y,
    size: FONT.small,
    font,
    color: COLOURS.muted,
  })
}

/**
 * Word-wrap text to fit within a maximum width.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  if (!text) return ['']
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const testWidth = font.widthOfTextAtSize(testLine, fontSize)
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

/**
 * Check if we need a new page to fit the required height.
 */
export function needsNewPage(y: number, requiredHeight: number): boolean {
  return y - requiredHeight < PAGE.marginBottom
}

/**
 * Get the colour for a classification code.
 */
export function getCodeColour(code: string): Color {
  switch (code) {
    case 'C1': return COLOURS.c1
    case 'C2': return COLOURS.c2
    case 'C3': return COLOURS.c3
    case 'FI': return COLOURS.fi
    default: return COLOURS.text
  }
}
