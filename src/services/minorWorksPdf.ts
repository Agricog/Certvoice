/**
 * CertVoice — Minor Works PDF Generator
 *
 * Client-side PDF generation using pdf-lib + shared pdfStyles helpers.
 * Produces a single-page (or two-page) PDF matching
 * BS 7671 Model Form 3 layout.
 *
 * @module services/minorWorksPdf
 */

import { PDFDocument, StandardFonts, type PDFPage, type PDFFont } from 'pdf-lib'
import type { MinorWorksCertificate } from '../types/minorWorks'
import {
  PAGE,
  CONTENT_WIDTH,
  COLOURS,
  FONT,
  SPACING,
  drawSectionHeader,
  drawField,
  drawWrappedField,
  drawFieldPair,
  drawHorizontalRule,
  drawPageFooter,
  needsNewPage,
  wrapText,
} from './pdfStyles'

// ── Types ───────────────────────────────────────────────────────

interface FontSet {
  regular: PDFFont
  bold: PDFFont
}

// ── Helpers ─────────────────────────────────────────────────────

function s(val: unknown): string {
  if (val == null || val === '') return '--'
  return String(val)
}

function earthingLabel(type: string): string {
  const map: Record<string, string> = {
    TN_C: 'TN-C', TN_S: 'TN-S', TN_C_S: 'TN-C-S', TT: 'TT', IT: 'IT',
  }
  return map[type] || type || '--'
}

function capitalise(str: string): string {
  if (!str) return '--'
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// ── Page header ─────────────────────────────────────────────────

function drawMWHeader(
  page: PDFPage,
  fonts: FontSet,
  certId: string,
  pageNum: number,
): number {
  const y = PAGE.height - PAGE.marginTop

  // Dark header bar
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - SPACING.pageHeaderHeight,
    width: CONTENT_WIDTH,
    height: SPACING.pageHeaderHeight,
    color: COLOURS.headerBg,
  })

  // Accent bar at top
  page.drawRectangle({
    x: PAGE.marginLeft,
    y,
    width: CONTENT_WIDTH,
    height: 2,
    color: COLOURS.accent,
  })

  page.drawText('MINOR ELECTRICAL INSTALLATION WORKS CERTIFICATE', {
    x: PAGE.marginLeft + 10,
    y: y - 18,
    size: 10,
    font: fonts.bold,
    color: COLOURS.white,
  })

  page.drawText('Requirements for Electrical Installations — IET Wiring Regulations BS 7671', {
    x: PAGE.marginLeft + 10,
    y: y - 30,
    size: FONT.small,
    font: fonts.regular,
    color: COLOURS.muted,
  })

  const idText = `Ref: ${certId.substring(0, 8).toUpperCase()}`
  const iw = fonts.bold.widthOfTextAtSize(idText, FONT.reportNumber)
  page.drawText(idText, {
    x: PAGE.width - PAGE.marginRight - iw - 10,
    y: y - 18,
    size: FONT.reportNumber,
    font: fonts.bold,
    color: COLOURS.accent,
  })

  if (pageNum > 1) {
    const pageText = `Page ${pageNum}`
    const pw = fonts.regular.widthOfTextAtSize(pageText, FONT.pageNumber)
    page.drawText(pageText, {
      x: PAGE.width - PAGE.marginRight - pw - 10,
      y: y - 30,
      size: FONT.pageNumber,
      font: fonts.regular,
      color: COLOURS.muted,
    })
  }

  return y - SPACING.pageHeaderHeight - SPACING.sectionGap
}

// ── Main generator ──────────────────────────────────────────────

export async function generateMinorWorksPdf(cert: MinorWorksCertificate): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fonts: FontSet = { regular, bold }

  pdfDoc.setTitle('Minor Electrical Installation Works Certificate')
  pdfDoc.setAuthor(cert.declaration?.installerName || 'CertVoice')
  pdfDoc.setSubject('Minor Works Certificate per BS 7671')
  pdfDoc.setCreator('CertVoice - certvoice.co.uk')
  pdfDoc.setCreationDate(new Date())

  let page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let pageNum = 1
  let y = drawMWHeader(page, fonts, cert.id, pageNum)

  // Helper: check page space, add new page if needed
  function ensureSpace(requiredHeight: number) {
    if (needsNewPage(y, requiredHeight)) {
      drawPageFooter(page, fonts.regular)
      page = pdfDoc.addPage([PAGE.width, PAGE.height])
      pageNum++
      y = drawMWHeader(page, fonts, cert.id, pageNum)
    }
  }

  // ═════════════════════════════════════════════════════════════
  // PART 1: DESCRIPTION OF MINOR WORKS
  // ═════════════════════════════════════════════════════════════
  y = drawSectionHeader(page, fonts.bold, y, 'Part 1 - Description of Minor Works')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Client', value: s(cert.clientDetails.clientName) },
    { label: 'Date of Completion', value: s(cert.description.dateOfCompletion) },
  )

  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Installation Address', s(cert.clientDetails.clientAddress))
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Description of Work', s(cert.description.descriptionOfWork))

  if (cert.description.commentsOnExisting) {
    y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Comments on Existing', s(cert.description.commentsOnExisting))
  }

  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // PART 2: INSTALLATION DETAILS
  // ═════════════════════════════════════════════════════════════
  ensureSpace(60)
  y = drawSectionHeader(page, fonts.bold, y, 'Part 2 - Installation Details')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Earthing System', value: earthingLabel(cert.installation.earthingType) },
    { label: 'Fault Protection', value: s(cert.installation.methodOfFaultProtection) },
  )

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Protective Device Type', value: s(cert.installation.existingProtectiveDevice.type) },
    { label: 'Rating', value: cert.installation.existingProtectiveDevice.rating ? `${cert.installation.existingProtectiveDevice.rating}A` : '--' },
  )

  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // PART 3: CIRCUIT DETAILS
  // ═════════════════════════════════════════════════════════════
  ensureSpace(80)
  y = drawSectionHeader(page, fonts.bold, y, 'Part 3 - Circuit Details')

  y = drawField(page, fonts.regular, fonts.bold, y, 'Circuit Description', s(cert.circuit.circuitDescription))

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'DB Reference', value: s(cert.circuit.dbReference) },
    { label: 'Circuit No.', value: s(cert.circuit.circuitDesignation) },
  )

  y = drawField(page, fonts.regular, fonts.bold, y, 'Protective Device',
    `${s(cert.circuit.protectiveDevice.bs)} Type ${s(cert.circuit.protectiveDevice.type)} ${s(cert.circuit.protectiveDevice.rating)}A`,
  )

  y = drawField(page, fonts.regular, fonts.bold, y, 'Wiring System',
    `${s(cert.circuit.wiringSystem.cableType)} ${s(cert.circuit.wiringSystem.csa)}mm2 Ref ${s(cert.circuit.wiringSystem.referenceMethod)}`,
  )

  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // PART 4: TEST RESULTS
  // ═════════════════════════════════════════════════════════════
  ensureSpace(100)
  y = drawSectionHeader(page, fonts.bold, y, 'Part 4 - Test Results')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'R1+R2', value: cert.testResults.earthContinuity.r1PlusR2 ? `${cert.testResults.earthContinuity.r1PlusR2} ohm` : '--' },
    { label: 'R2', value: cert.testResults.earthContinuity.r2 ? `${cert.testResults.earthContinuity.r2} ohm` : '--' },
  )

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Insulation L-E', value: cert.testResults.insulationResistance.liveToEarth ? `${cert.testResults.insulationResistance.liveToEarth} M ohm` : '--' },
    { label: 'Insulation L-N', value: cert.testResults.insulationResistance.liveToNeutral ? `${cert.testResults.insulationResistance.liveToNeutral} M ohm` : '--' },
  )

  y = drawField(page, fonts.regular, fonts.bold, y, 'Zs', cert.testResults.earthFaultLoopImpedance.zs ? `${cert.testResults.earthFaultLoopImpedance.zs} ohm` : '--')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Polarity', value: capitalise(cert.testResults.polarity) },
    { label: 'Functional Testing', value: capitalise(cert.testResults.functionalTesting) },
  )

  if (cert.testResults.rcd.present) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'RCD Rated Idn', value: cert.testResults.rcd.ratedResidualCurrent ? `${cert.testResults.rcd.ratedResidualCurrent} mA` : '--' },
      { label: 'RCD Operating Time', value: cert.testResults.rcd.operatingTime ? `${cert.testResults.rcd.operatingTime} ms` : '--' },
    )
  }

  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // PART 5: DECLARATION
  // ═════════════════════════════════════════════════════════════
  ensureSpace(120)
  y = drawSectionHeader(page, fonts.bold, y, 'Part 5 - Declaration')

  // Declaration text
  const declText =
    'I/We, being the person(s) responsible for the electrical installation work, hereby declare ' +
    'that the work detailed does not impair the safety of the existing installation and that it ' +
    'has been designed, constructed, inspected and tested in accordance with BS 7671 ' +
    '(IET Wiring Regulations).'
  const declLines = wrapText(declText, fonts.regular, FONT.label, CONTENT_WIDTH - 4)
  for (const line of declLines) {
    page.drawText(line, {
      x: PAGE.marginLeft + 2,
      y,
      size: FONT.label,
      font: fonts.regular,
      color: COLOURS.muted,
    })
    y -= 9
  }
  y -= 4

  drawHorizontalRule(page, y + 4, COLOURS.borderLight)
  y -= 2

  y = drawField(page, fonts.regular, fonts.bold, y, 'Contractor', s(cert.declaration.contractorName))
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Address', s(cert.declaration.contractorAddress))

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Telephone', value: s(cert.declaration.contractorTelephone) },
    { label: 'Email', value: s(cert.declaration.contractorEmail) },
  )

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Installer Name', value: s(cert.declaration.installerName) },
    { label: 'Date', value: s(cert.declaration.installerDate) },
  )

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Scheme Provider', value: s(cert.declaration.schemeProvider) },
    { label: 'Membership No.', value: s(cert.declaration.schemeMembershipNumber) },
  )

  y = drawField(page, fonts.regular, fonts.bold, y, 'Signature', cert.declaration.installerSignature ? '[Signature on file]' : '______________________')

  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // PART 6: NEXT INSPECTION
  // ═════════════════════════════════════════════════════════════
  ensureSpace(40)
  y = drawSectionHeader(page, fonts.bold, y, 'Part 6 - Next Inspection')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Recommended Date', value: s(cert.nextInspection.recommendedDate) },
    { label: 'Reason', value: s(cert.nextInspection.reason) },
  )

  // ═════════════════════════════════════════════════════════════
  // PART P NOTIFICATION REMINDER
  // ═════════════════════════════════════════════════════════════
  if (cert.schemeNotification.partPRequired) {
    ensureSpace(30)
    y -= 4

    // Amber info box
    page.drawRectangle({
      x: PAGE.marginLeft,
      y: y - 18,
      width: CONTENT_WIDTH,
      height: 22,
      color: COLOURS.rowAlt,
    })

    // Left accent bar (using c2 = amber)
    page.drawRectangle({
      x: PAGE.marginLeft,
      y: y - 18,
      width: 3,
      height: 22,
      color: COLOURS.c2,
    })

    page.drawText('PART P NOTIFICATION', {
      x: PAGE.marginLeft + 8,
      y: y - 6,
      size: FONT.label,
      font: fonts.bold,
      color: COLOURS.c2,
    })

    const notifStatus = cert.schemeNotification.notificationSubmitted
      ? `Submitted ${cert.schemeNotification.notificationDate || ''} — Ref: ${cert.schemeNotification.schemeReference || 'pending'}`
      : 'Not yet submitted — notify via scheme provider portal'

    page.drawText(notifStatus, {
      x: PAGE.marginLeft + 8,
      y: y - 15,
      size: FONT.small,
      font: fonts.regular,
      color: COLOURS.muted,
    })
  }

  // ═════════════════════════════════════════════════════════════
  // FOOTER
  // ═════════════════════════════════════════════════════════════
  drawPageFooter(page, fonts.regular)

  return await pdfDoc.save()
}

// ── Browser helpers ─────────────────────────────────────────────

/**
 * Generate MW PDF and return a blob URL for download.
 */
export async function generateMinorWorksBlobUrl(
  cert: MinorWorksCertificate,
): Promise<{ url: string; filename: string }> {
  const pdfBytes = await generateMinorWorksPdf(cert)
  const buffer = new ArrayBuffer(pdfBytes.byteLength)
  new Uint8Array(buffer).set(pdfBytes)
  const blob = new Blob([buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const addr = (cert.clientDetails.clientAddress || '').split('\n')[0]?.trim().replace(/[^a-zA-Z0-9]/g, '_') || 'MinorWorks'
  const filename = `MW_${addr}_${cert.description.dateOfCompletion || 'draft'}.pdf`
  return { url, filename }
}
