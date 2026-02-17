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
  /** Near-black for body text */
  text: rgb(0.1, 0.1, 0.12),
  /** Mid-grey for labels and secondary text */
  muted: rgb(0.45, 0.45, 0.5),
  /** Light grey for table borders */
  border: rgb(0.78, 0.78, 0.82),
  /** Very light grey for alternating table rows */
  rowAlt: rgb(0.95, 0.95, 0.96),
  /** White */
  white: rgb(1, 1, 1),
  /** CertVoice brand accent (blue) */
  accent: rgb(0.24, 0.47, 0.96),
  /** Dark header background */
  headerBg: rgb(0.12, 0.14, 0.18),
  /** Section header background */
  sectionBg: rgb(0.22, 0.25, 0.3),
  /** C1 danger red */
  c1: rgb(0.87, 0.17, 0.17),
  /** C2 amber/orange */
  c2: rgb(0.91, 0.6, 0.08),
  /** C3 green */
  c3: rgb(0.16, 0.65, 0.27),
  /** FI blue */
  fi: rgb(0.24, 0.47, 0.96),
  /** Pass green */
  pass: rgb(0.16, 0.65, 0.27),
  /** Fail red */
  fail: rgb(0.87, 0.17, 0.17),
} as const

// ============================================================
// FONT SIZES
// ============================================================

export const FONT = {
  /** Main document title */
  title: 16,
  /** Section headers (A, B, C...) */
  sectionHeader: 10,
  /** Field labels */
  label: 7,
  /** Field values */
  value: 8.5,
  /** Table header text */
  tableHeader: 6.5,
  /** Table body text */
  tableBody: 7,
  /** Small print / footer */
  small: 6,
  /** Page number */
  pageNumber: 7,
  /** Report number in header */
  reportNumber: 8,
} as const

// ============================================================
// SPACING
// ============================================================

export const SPACING = {
  /** Space between sections */
  sectionGap: 14,
  /** Space between field rows within a section */
  fieldRowGap: 16,
  /** Height of section header bar */
  sectionHeaderHeight: 18,
  /** Height of a standard field row */
  fieldRowHeight: 14,
  /** Padding inside section header */
  sectionHeaderPadding: 5,
  /** Height of table header row */
  tableHeaderHeight: 16,
  /** Height of table body row */
  tableRowHeight: 14,
  /** Height of page header */
  pageHeaderHeight: 50,
  /** Line height multiplier for wrapped text */
  lineHeight: 1.3,
} as const

// ============================================================
// DRAWING HELPERS
// ============================================================

/**
 * Draw the page header (appears on every page).
 * Dark background bar with CertVoice branding, report number, and page info.
 */
export function drawPageHeader(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  reportNumber: string,
  pageNum: number,
  totalPages: number
): number {
  const { width, marginLeft, marginRight } = PAGE
  const y = PAGE.height - PAGE.marginTop

  // Dark header bar
  page.drawRectangle({
    x: marginLeft,
    y: y - SPACING.pageHeaderHeight,
    width: width - marginLeft - marginRight,
    height: SPACING.pageHeaderHeight,
    color: COLOURS.headerBg,
  })

  // Title
  page.drawText('ELECTRICAL INSTALLATION CONDITION REPORT', {
    x: marginLeft + 10,
    y: y - 20,
    size: 11,
    font: fontBold,
    color: COLOURS.white,
  })

  // Subtitle
  page.drawText('In accordance with BS 7671', {
    x: marginLeft + 10,
    y: y - 33,
    size: FONT.small,
    font,
    color: rgb(0.6, 0.6, 0.65),
  })

  // Report number (right side)
  const reportText = `Report: ${reportNumber}`
  const reportWidth = fontBold.widthOfTextAtSize(reportText, FONT.reportNumber)
  page.drawText(reportText, {
    x: width - marginRight - reportWidth - 10,
    y: y - 20,
    size: FONT.reportNumber,
    font: fontBold,
    color: COLOURS.accent,
  })

  // Page number (right side, below report)
  const pageText = `Page ${pageNum} of ${totalPages}`
  const pageWidth = font.widthOfTextAtSize(pageText, FONT.pageNumber)
  page.drawText(pageText, {
    x: width - marginRight - pageWidth - 10,
    y: y - 33,
    size: FONT.pageNumber,
    font,
    color: rgb(0.6, 0.6, 0.65),
  })

  // Return Y position below header
  return y - SPACING.pageHeaderHeight - SPACING.sectionGap
}

/**
 * Draw a section header bar (e.g. "SECTION A — CLIENT DETAILS").
 * Returns Y position below the header.
 */
export function drawSectionHeader(
  page: PDFPage,
  fontBold: PDFFont,
  y: number,
  label: string
): number {
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - SPACING.sectionHeaderHeight,
    width: CONTENT_WIDTH,
    height: SPACING.sectionHeaderHeight,
    color: COLOURS.sectionBg,
  })

  page.drawText(label.toUpperCase(), {
    x: PAGE.marginLeft + SPACING.sectionHeaderPadding,
    y: y - SPACING.sectionHeaderHeight + SPACING.sectionHeaderPadding,
    size: FONT.sectionHeader,
    font: fontBold,
    color: COLOURS.white,
  })

  return y - SPACING.sectionHeaderHeight - 6
}

/**
 * Draw a labelled field: "Label: Value" on one line.
 * Returns Y position after the field.
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
  }
): number {
  const x = options?.x ?? PAGE.marginLeft
  const labelWidth = options?.labelWidth ?? 130
  const valueColour = options?.valueColour ?? COLOURS.text

  // Label
  page.drawText(label, {
    x,
    y,
    size: FONT.label,
    font,
    color: COLOURS.muted,
  })

  // Value
  page.drawText(value || '—', {
    x: x + labelWidth,
    y,
    size: FONT.value,
    font: fontBold,
    color: valueColour,
  })

  return y - SPACING.fieldRowGap
}

/**
 * Draw two fields side by side on one row.
 * Returns Y position after the row.
 */
export function drawFieldPair(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  y: number,
  field1: { label: string; value: string },
  field2: { label: string; value: string }
): number {
  const halfWidth = CONTENT_WIDTH / 2
  const labelWidth = 110

  drawField(page, font, fontBold, y, field1.label, field1.value, {
    x: PAGE.marginLeft,
    labelWidth,
  })

  drawField(page, font, fontBold, y, field2.label, field2.value, {
    x: PAGE.marginLeft + halfWidth,
    labelWidth,
  })

  return y - SPACING.fieldRowGap
}

/**
 * Draw a horizontal rule (thin line).
 */
export function drawHorizontalRule(
  page: PDFPage,
  y: number,
  colour?: Color
): void {
  page.drawLine({
    start: { x: PAGE.marginLeft, y },
    end: { x: PAGE.width - PAGE.marginRight, y },
    thickness: 0.5,
    color: colour ?? COLOURS.border,
  })
}

/**
 * Draw a table header row.
 * Returns Y position below the header.
 */
export function drawTableHeader(
  page: PDFPage,
  fontBold: PDFFont,
  y: number,
  columns: { label: string; width: number; align?: 'left' | 'center' | 'right' }[]
): number {
  const rowY = y - SPACING.tableHeaderHeight

  // Header background
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: rowY,
    width: CONTENT_WIDTH,
    height: SPACING.tableHeaderHeight,
    color: COLOURS.sectionBg,
  })

  // Column labels
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
      y: rowY + 5,
      size: FONT.tableHeader,
      font: fontBold,
      color: COLOURS.white,
    })

    colX += col.width
  }

  return rowY
}

/**
 * Draw a table body row.
 * Returns Y position below the row.
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
  }
): number {
  const rowHeight = options?.rowHeight ?? SPACING.tableRowHeight
  const rowY = y - rowHeight

  // Alternating row background
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
    color: COLOURS.border,
  })

  // Cell values
  let colX = PAGE.marginLeft
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    const text = values[i] ?? ''

    // Truncate text to fit column
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
      y: rowY + 4,
      size: FONT.tableBody,
      font,
      color: options?.textColour ?? COLOURS.text,
    })

    colX += col.width
  }

  return rowY
}

/**
 * Draw page footer with CertVoice branding.
 */
export function drawPageFooter(
  page: PDFPage,
  font: PDFFont
): void {
  const y = PAGE.marginBottom - 20
  const text = 'Generated by CertVoice — certvoice.co.uk'
  const textWidth = font.widthOfTextAtSize(text, FONT.small)

  page.drawText(text, {
    x: (PAGE.width - textWidth) / 2,
    y,
    size: FONT.small,
    font,
    color: COLOURS.muted,
  })
}

/**
 * Wrap text to fit within a given width.
 * Returns array of lines.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
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
 * Check if there's enough space on the current page for the given height.
 * Returns true if a new page is needed.
 */
export function needsNewPage(y: number, requiredHeight: number): boolean {
  return y - requiredHeight < PAGE.marginBottom
}

/**
 * Get the classification code colour.
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
