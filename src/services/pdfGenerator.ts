/**
 * CertVoice — EICR PDF Generator (Client-Side)
 *
 * Generates official BS 7671:2018+A2:2022 compliant EICR certificates
 * using pdf-lib. Runs entirely in the browser — works offline.
 *
 * Pages:
 *   1. Sections A-D (client, reason, installation, extent/limitations)
 *   2. Sections E-G (summary, recommendations, declaration + signatures)
 *   3. Sections I-J (supply characteristics, installation particulars)
 *   4+. Section K observations table (dynamic, overflows)
 *   N+. Schedule of inspections checklist (dynamic, overflows)
 *   N+. Circuit test results schedule (dynamic, overflows)
 *
 * Signatures:
 *   Fetches PNG images from R2 via worker. Falls back to
 *   "[Signature on file]" if offline or fetch fails.
 *
 * Usage:
 *   import { downloadEICRPdf } from './pdfGenerator'
 *   await downloadEICRPdf(certificate)
 *
 * @module services/pdfGenerator
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib'
import type { EICRCertificate } from '../types/eicr'
import { STYLES } from './pdfStyles'

// ============================================================
// SIGNATURE FETCHER
// ============================================================

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

/**
 * Fetch a signature PNG from R2 as raw bytes.
 * Returns null on any failure (offline, auth expired, etc.)
 */
async function fetchSignaturePng(key: string): Promise<Uint8Array | null> {
  try {
    const clerk = (
      window as unknown as {
        Clerk?: { session?: { getToken: () => Promise<string | null> } | null }
      }
    ).Clerk
    const token = clerk?.session ? await clerk.session.getToken() : null
    if (!token) return null

    const res = await fetch(`${BASE_URL}/api/download-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ key }),
    })

    if (!res.ok) return null

    const blob = await res.blob()
    const buffer = await blob.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

// ============================================================
// TYPES
// ============================================================

interface FontSet {
  helvetica: PDFFont
  helveticaBold: PDFFont
}

interface SignatureImages {
  inspector: Uint8Array | null
  qs: Uint8Array | null
}

// ============================================================
// DRAWING HELPERS
// ============================================================

const { PAGE, FONT_SIZES, COLOURS } = STYLES
const MARGIN = PAGE.MARGIN
const CONTENT_W = PAGE.WIDTH - MARGIN * 2

/** Draw a single label (muted colour) */
function drawLabel(
  page: PDFPage,
  label: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
): void {
  page.drawText(label, { x, y, size, font, color: COLOURS.MUTED })
}

/** Draw a single value (dark colour) */
function drawValue(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
): void {
  page.drawText(value, { x, y, size, font, color: COLOURS.TEXT })
}

/** Draw label: value pair on one line */
function drawLabelValue(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  fonts: FontSet,
  labelWidth: number,
): void {
  page.drawText(label, {
    x,
    y,
    size: FONT_SIZES.LABEL,
    font: fonts.helvetica,
    color: COLOURS.MUTED,
  })
  page.drawText(value || '—', {
    x: x + labelWidth,
    y,
    size: FONT_SIZES.VALUE,
    font: fonts.helvetica,
    color: COLOURS.TEXT,
  })
}

/** Draw a section header bar */
function drawSectionHeader(
  page: PDFPage,
  title: string,
  x: number,
  y: number,
  width: number,
  fonts: FontSet,
): number {
  const barH = 18
  page.drawRectangle({
    x,
    y: y - barH + 4,
    width,
    height: barH,
    color: COLOURS.HEADER_BG,
  })
  page.drawText(title, {
    x: x + 6,
    y: y - 8,
    size: FONT_SIZES.SECTION,
    font: fonts.helveticaBold,
    color: COLOURS.HEADER_TEXT,
  })
  return y - barH - 8
}

/** Draw page header with report number and page count */
function drawPageHeader(
  page: PDFPage,
  reportNumber: string,
  fonts: FontSet,
): void {
  // Title
  page.drawText('ELECTRICAL INSTALLATION CONDITION REPORT', {
    x: MARGIN,
    y: PAGE.HEIGHT - MARGIN,
    size: FONT_SIZES.TITLE,
    font: fonts.helveticaBold,
    color: COLOURS.TEXT,
  })

  // Subtitle
  page.drawText('To BS 7671:2018+A2:2022 — IET Wiring Regulations', {
    x: MARGIN,
    y: PAGE.HEIGHT - MARGIN - 14,
    size: FONT_SIZES.LABEL,
    font: fonts.helvetica,
    color: COLOURS.MUTED,
  })

  // Report number (right aligned)
  const reportText = `Report No: ${reportNumber || '—'}`
  const rw = fonts.helveticaBold.widthOfTextAtSize(reportText, FONT_SIZES.VALUE)
  page.drawText(reportText, {
    x: PAGE.WIDTH - MARGIN - rw,
    y: PAGE.HEIGHT - MARGIN,
    size: FONT_SIZES.VALUE,
    font: fonts.helveticaBold,
    color: COLOURS.ACCENT,
  })

  // Divider
  page.drawLine({
    start: { x: MARGIN, y: PAGE.HEIGHT - MARGIN - 22 },
    end: { x: PAGE.WIDTH - MARGIN, y: PAGE.HEIGHT - MARGIN - 22 },
    thickness: 1,
    color: COLOURS.LINE,
  })
}

/** Draw page footer */
function drawPageFooter(
  page: PDFPage,
  pageNum: number,
  fonts: FontSet,
): void {
  const footerY = MARGIN - 10
  page.drawLine({
    start: { x: MARGIN, y: footerY + 12 },
    end: { x: PAGE.WIDTH - MARGIN, y: footerY + 12 },
    thickness: 0.5,
    color: COLOURS.LINE,
  })

  page.drawText('Generated by CertVoice — certvoice.co.uk', {
    x: MARGIN,
    y: footerY,
    size: 7,
    font: fonts.helvetica,
    color: COLOURS.MUTED,
  })

  const pageText = `Page ${pageNum}`
  const pw = fonts.helvetica.widthOfTextAtSize(pageText, 7)
  page.drawText(pageText, {
    x: PAGE.WIDTH - MARGIN - pw,
    y: footerY,
    size: 7,
    font: fonts.helvetica,
    color: COLOURS.MUTED,
  })
}

/** Check if we need a new page (returns true if y is below safe zone) */
function needsNewPage(y: number): boolean {
  return y < MARGIN + 40
}

// ============================================================
// PAGE 1: SECTIONS A-D
// ============================================================

function drawClientInstallationPage(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
): PDFPage {
  const page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
  drawPageHeader(page, cert.reportNumber, fonts)

  const x = MARGIN
  const LABEL_W = 160
  const ROW_H = 16
  let y = PAGE.HEIGHT - MARGIN - 40

  // --- Section A: Client Details ---
  y = drawSectionHeader(page, 'SECTION A — DETAILS OF THE CLIENT', x, y, CONTENT_W, fonts)

  drawLabelValue(page, 'Client Name:', cert.clientDetails.clientName, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Client Address:', cert.clientDetails.clientAddress, x, y, fonts, LABEL_W)
  y -= ROW_H * 1.5

  // --- Section B: Reason for Report ---
  y = drawSectionHeader(page, 'SECTION B — PURPOSE OF THE REPORT', x, y, CONTENT_W, fonts)

  const purposeMap: Record<string, string> = {
    PERIODIC: 'Periodic inspection',
    CHANGE_OF_OCCUPANCY: 'Change of occupancy',
    MORTGAGE: 'Mortgage / sale',
    INSURANCE: 'Insurance requirement',
    SAFETY_CONCERN: 'Safety concern',
    OTHER: 'Other',
  }
  drawLabelValue(page, 'Purpose:', purposeMap[cert.reportReason.purpose] ?? cert.reportReason.purpose, x, y, fonts, LABEL_W)
  y -= ROW_H

  const dates = cert.reportReason.inspectionDates
    .map((d) => {
      try { return new Date(d).toLocaleDateString('en-GB') } catch { return d }
    })
    .join(', ')
  drawLabelValue(page, 'Date(s) of Inspection:', dates || '—', x, y, fonts, LABEL_W)
  y -= ROW_H * 1.5

  // --- Section C: Installation Details ---
  y = drawSectionHeader(page, 'SECTION C — DETAILS OF THE INSTALLATION', x, y, CONTENT_W, fonts)

  drawLabelValue(page, 'Installation Address:', cert.installationDetails.installationAddress, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Occupier:', cert.installationDetails.occupier, x, y, fonts, LABEL_W)
  y -= ROW_H

  const premisesMap: Record<string, string> = {
    DOMESTIC: 'Domestic',
    COMMERCIAL: 'Commercial',
    INDUSTRIAL: 'Industrial',
    OTHER: cert.installationDetails.otherDescription ?? 'Other',
  }
  drawLabelValue(page, 'Type of Premises:', premisesMap[cert.installationDetails.premisesType] ?? '—', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Est. Age of Wiring:', cert.installationDetails.estimatedAgeOfWiring != null ? `${cert.installationDetails.estimatedAgeOfWiring} years` : '—', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Additions/Alterations:', cert.installationDetails.evidenceOfAdditions ? 'Yes' : 'No', x, y, fonts, LABEL_W)
  y -= ROW_H

  if (cert.installationDetails.evidenceOfAdditions && cert.installationDetails.additionsEstimatedAge != null) {
    drawLabelValue(page, 'Est. Age of Additions:', `${cert.installationDetails.additionsEstimatedAge} years`, x, y, fonts, LABEL_W)
    y -= ROW_H
  }

  drawLabelValue(page, 'Previous Records:', cert.installationDetails.installationRecordsAvailable ? 'Available' : 'Not available', x, y, fonts, LABEL_W)
  y -= ROW_H

  const lastInsp = cert.installationDetails.dateOfLastInspection
  drawLabelValue(page, 'Date of Last Inspection:', lastInsp ? new Date(lastInsp).toLocaleDateString('en-GB') : 'N/A', x, y, fonts, LABEL_W)
  y -= ROW_H * 1.5

  // --- Section D: Extent and Limitations ---
  y = drawSectionHeader(page, 'SECTION D — EXTENT AND LIMITATIONS', x, y, CONTENT_W, fonts)

  drawLabelValue(page, 'Extent Covered:', cert.extentAndLimitations.extentCovered, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Agreed Limitations:', cert.extentAndLimitations.agreedLimitations, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Agreed With:', cert.extentAndLimitations.agreedWith, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Operational Limitations:', cert.extentAndLimitations.operationalLimitations, x, y, fonts, LABEL_W)

  drawPageFooter(page, 1, fonts)
  return page
}

// ============================================================
// PAGE 2: SECTIONS E-G (DECLARATION + SIGNATURES)
// ============================================================

async function drawDeclarationPage(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
  sigImages: SignatureImages,
): Promise<PDFPage> {
  const page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
  drawPageHeader(page, cert.reportNumber, fonts)

  const x = MARGIN
  const LABEL_W = 160
  const ROW_H = 16
  let y = PAGE.HEIGHT - MARGIN - 40

  // --- Section E: Summary of Condition ---
  y = drawSectionHeader(page, 'SECTION E — SUMMARY OF THE CONDITION OF THE INSTALLATION', x, y, CONTENT_W, fonts)

  drawLabelValue(page, 'General Condition:', cert.summaryOfCondition.generalCondition, x, y, fonts, LABEL_W)
  y -= ROW_H

  const assessment = cert.summaryOfCondition.overallAssessment
  const assessColour = assessment === 'SATISFACTORY' ? COLOURS.PASS : COLOURS.FAIL
  drawLabel(page, 'Overall Assessment:', x, y, fonts.helvetica, FONT_SIZES.LABEL)
  page.drawText(assessment || '—', {
    x: x + LABEL_W,
    y,
    size: FONT_SIZES.VALUE + 1,
    font: fonts.helveticaBold,
    color: assessColour,
  })
  y -= ROW_H * 1.5

  // --- Section F: Recommendations ---
  y = drawSectionHeader(page, 'SECTION F — RECOMMENDATIONS', x, y, CONTENT_W, fonts)

  const nextDate = cert.recommendations.nextInspectionDate
  drawLabelValue(page, 'Next Inspection Date:', nextDate ? new Date(nextDate).toLocaleDateString('en-GB') : '—', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Reason for Interval:', cert.recommendations.reasonForInterval, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Remedial Urgency:', cert.recommendations.remedialUrgency, x, y, fonts, LABEL_W)
  y -= ROW_H * 1.5

  // --- Section G: Declaration ---
  y = drawSectionHeader(page, 'SECTION G — DECLARATION', x, y, CONTENT_W, fonts)

  // Declaration text
  const declText = 'I/We, being the person(s) responsible for the inspection and testing of the electrical installation, particulars of which are described in this report, having exercised reasonable skill and care when carrying out the inspection and testing, hereby declare that the information in this report, including the observations and the attached schedules, provides an accurate assessment of the condition of the electrical installation.'
  const declLines = splitTextToLines(declText, fonts.helvetica, FONT_SIZES.SMALL, CONTENT_W)
  for (const line of declLines) {
    page.drawText(line, {
      x,
      y,
      size: FONT_SIZES.SMALL,
      font: fonts.helvetica,
      color: COLOURS.TEXT,
    })
    y -= 11
  }
  y -= 6

  // Inspector details
  const decl = cert.declaration

  drawLabelValue(page, 'Inspector Name:', decl.inspectorName, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Position:', decl.position, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Company:', decl.companyName, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Company Address:', decl.companyAddress, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Registration No:', decl.registrationNumber, x, y, fonts, LABEL_W)
  y -= ROW_H

  const inspDate = decl.dateInspected
  drawLabelValue(page, 'Date Inspected:', inspDate ? new Date(inspDate).toLocaleDateString('en-GB') : '—', x, y, fonts, LABEL_W)
  y -= ROW_H

  // Inspector signature
  if (sigImages.inspector) {
    drawLabel(page, 'Signature:', x, y, fonts.helvetica, FONT_SIZES.LABEL)
    try {
      const img = await pdfDoc.embedPng(sigImages.inspector)
      const h = 28
      const w = Math.min(h * (img.width / img.height), 150)
      page.drawImage(img, { x: x + LABEL_W, y: y - h + 4, width: w, height: h })
    } catch {
      drawValue(page, '[Signature on file]', x + LABEL_W, y, fonts.helvetica, FONT_SIZES.VALUE)
    }
  } else {
    drawLabelValue(
      page,
      'Signature:',
      decl.inspectorSignatureKey ? '[Signature on file]' : '______________________',
      x, y, fonts, LABEL_W,
    )
  }
  y -= ROW_H * 2

  // Divider
  page.drawLine({
    start: { x, y: y + 6 },
    end: { x: x + CONTENT_W, y: y + 6 },
    thickness: 0.5,
    color: COLOURS.LINE,
  })
  y -= 8

  // QS details
  drawLabelValue(page, 'QS Name:', decl.qsName, x, y, fonts, LABEL_W)
  y -= ROW_H

  const qsDate = decl.qsDate
  drawLabelValue(page, 'Date Authorised:', qsDate ? new Date(qsDate).toLocaleDateString('en-GB') : '—', x, y, fonts, LABEL_W)
  y -= ROW_H

  // QS signature
  if (sigImages.qs) {
    drawLabel(page, 'Signature:', x, y, fonts.helvetica, FONT_SIZES.LABEL)
    try {
      const img = await pdfDoc.embedPng(sigImages.qs)
      const h = 28
      const w = Math.min(h * (img.width / img.height), 150)
      page.drawImage(img, { x: x + LABEL_W, y: y - h + 4, width: w, height: h })
    } catch {
      drawValue(page, '[Signature on file]', x + LABEL_W, y, fonts.helvetica, FONT_SIZES.VALUE)
    }
  } else {
    drawLabelValue(
      page,
      'Signature:',
      decl.qsSignatureKey ? '[Signature on file]' : '______________________',
      x, y, fonts, LABEL_W,
    )
  }

  drawPageFooter(page, 2, fonts)
  return page
}

// ============================================================
// PAGE 3: SECTIONS I-J (SUPPLY + PARTICULARS)
// ============================================================

function drawSupplyPage(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
): PDFPage {
  const page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
  drawPageHeader(page, cert.reportNumber, fonts)

  const x = MARGIN
  const LABEL_W = 180
  const ROW_H = 15
  let y = PAGE.HEIGHT - MARGIN - 40

  const supply = cert.supplyCharacteristics
  const install = cert.installationParticulars

  // --- Section I: Supply Characteristics ---
  y = drawSectionHeader(page, 'SECTION I — SUPPLY CHARACTERISTICS AND EARTHING ARRANGEMENTS', x, y, CONTENT_W, fonts)

  const earthingMap: Record<string, string> = {
    TN_C: 'TN-C', TN_S: 'TN-S', TN_C_S: 'TN-C-S', TT: 'TT', IT: 'IT',
  }
  drawLabelValue(page, 'Earthing System:', earthingMap[supply.earthingType ?? ''] ?? '—', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Supply Type:', supply.supplyType, x, y, fonts, LABEL_W)
  y -= ROW_H

  const configMap: Record<string, string> = {
    '1PH_2WIRE': '1-phase 2-wire', '2PH_3WIRE': '2-phase 3-wire',
    '3PH_3WIRE': '3-phase 3-wire', '3PH_4WIRE': '3-phase 4-wire',
  }
  drawLabelValue(page, 'Conductor Config:', configMap[supply.conductorConfig] ?? '—', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Nominal Voltage:', supply.nominalVoltage != null ? `${supply.nominalVoltage}V` : '—', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Nominal Frequency:', `${supply.nominalFrequency}Hz`, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Prospective Fault Current (Ipf):', supply.ipf != null ? `${supply.ipf} kA` : '—', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'External Loop Impedance (Ze):', supply.ze != null ? `${supply.ze}Ω` : '—', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Supply Polarity Confirmed:', supply.supplyPolarityConfirmed ? 'Yes' : 'No', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Other Sources Present:', supply.otherSourcesPresent ? `Yes — ${supply.otherSourcesDescription ?? ''}` : 'No', x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Supply Device BS(EN):', supply.supplyDeviceBsEn, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Supply Device Type:', supply.supplyDeviceType, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Supply Device Rating:', supply.supplyDeviceRating != null ? `${supply.supplyDeviceRating}A` : '—', x, y, fonts, LABEL_W)
  y -= ROW_H * 1.5

  // --- Section J: Installation Particulars ---
  y = drawSectionHeader(page, 'SECTION J — PARTICULARS OF THE INSTALLATION AT THE ORIGIN', x, y, CONTENT_W, fonts)

  drawLabelValue(page, 'Means of Earthing:', install.distributorFacility ? 'Distributor facility' : install.installationElectrode ? 'Installation electrode' : '—', x, y, fonts, LABEL_W)
  y -= ROW_H

  if (install.installationElectrode) {
    drawLabelValue(page, 'Electrode Type:', install.electrodeType ?? '—', x, y, fonts, LABEL_W)
    y -= ROW_H
    drawLabelValue(page, 'Electrode Location:', install.electrodeLocation ?? '—', x, y, fonts, LABEL_W)
    y -= ROW_H
    drawLabelValue(page, 'Electrode Resistance:', install.electrodeResistance != null ? `${install.electrodeResistance}Ω` : '—', x, y, fonts, LABEL_W)
    y -= ROW_H
  }

  drawLabelValue(page, 'Main Switch Location:', install.mainSwitchLocation, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Main Switch BS(EN):', install.mainSwitchBsEn, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Poles / Rating:', `${install.mainSwitchPoles ?? '—'}P / ${install.mainSwitchCurrentRating != null ? `${install.mainSwitchCurrentRating}A` : '—'}`, x, y, fonts, LABEL_W)
  y -= ROW_H

  // Earthing conductor
  drawLabelValue(page, 'Earthing Conductor:', `${install.earthingConductorMaterial} ${install.earthingConductorCsa != null ? `${install.earthingConductorCsa}mm²` : '—'} ${install.earthingConductorVerified ? '✓' : ''}`, x, y, fonts, LABEL_W)
  y -= ROW_H
  drawLabelValue(page, 'Bonding Conductor:', `${install.bondingConductorMaterial} ${install.bondingConductorCsa != null ? `${install.bondingConductorCsa}mm²` : '—'} ${install.bondingConductorVerified ? '✓' : ''}`, x, y, fonts, LABEL_W)
  y -= ROW_H

  // Bonding status
  const bondItems = [
    ['Water', install.bondingWater],
    ['Gas', install.bondingGas],
    ['Oil', install.bondingOil],
    ['Steel', install.bondingSteel],
    ['Lightning', install.bondingLightning],
    ['Other', install.bondingOther],
  ] as const

  const bondStr = bondItems
    .filter(([, v]) => v !== 'NA')
    .map(([k, v]) => `${k}: ${v === 'SATISFACTORY' ? '✓' : '✗'}`)
    .join('  |  ')

  if (bondStr) {
    drawLabelValue(page, 'Bonding:', bondStr, x, y, fonts, LABEL_W)
    y -= ROW_H
  }

  drawPageFooter(page, 3, fonts)
  return page
}

// ============================================================
// DYNAMIC PAGES: OBSERVATIONS (SECTION K)
// ============================================================

function drawObservationsPages(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
  startPage: number,
): number {
  const observations = cert.observations
  if (observations.length === 0) return startPage

  let page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
  let pageNum = startPage
  drawPageHeader(page, cert.reportNumber, fonts)

  const x = MARGIN
  const ROW_H = 14
  let y = PAGE.HEIGHT - MARGIN - 40

  y = drawSectionHeader(page, 'SECTION K — OBSERVATIONS AND RECOMMENDATIONS', x, y, CONTENT_W, fonts)

  // Table header
  const COL_WIDTHS = [30, 35, 220, 65, 80, 85]
  const HEADERS = ['Item', 'Code', 'Observation', 'Location', 'Regulation', 'Remedial Action']

  function drawObsTableHeader(p: PDFPage, yPos: number): number {
    let cx = x
    HEADERS.forEach((h, i) => {
      const col = COL_WIDTHS[i]
      if (!col) return
      p.drawText(h, {
        x: cx + 2,
        y: yPos,
        size: FONT_SIZES.SMALL,
        font: fonts.helveticaBold,
        color: COLOURS.HEADER_TEXT,
      })
      cx += col
    })
    p.drawLine({
      start: { x, y: yPos - 4 },
      end: { x: x + CONTENT_W, y: yPos - 4 },
      thickness: 0.75,
      color: COLOURS.LINE,
    })
    return yPos - ROW_H
  }

  y = drawObsTableHeader(page, y)

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]
    if (!obs) continue

    if (needsNewPage(y)) {
      drawPageFooter(page, pageNum, fonts)
      page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
      pageNum++
      drawPageHeader(page, cert.reportNumber, fonts)
      y = PAGE.HEIGHT - MARGIN - 40
      y = drawSectionHeader(page, 'SECTION K — OBSERVATIONS (continued)', x, y, CONTENT_W, fonts)
      y = drawObsTableHeader(page, y)
    }

    // Code colour
    const codeColour =
      obs.classificationCode === 'C1' ? COLOURS.FAIL
        : obs.classificationCode === 'C2' ? COLOURS.AMBER
          : obs.classificationCode === 'C3' ? COLOURS.MUTED
            : COLOURS.TEXT

    let cx = x
    // Item number
    page.drawText(String(obs.itemNumber), { x: cx + 2, y, size: FONT_SIZES.SMALL, font: fonts.helvetica, color: COLOURS.TEXT })
    cx += COL_WIDTHS[0] ?? 30

    // Code
    page.drawText(obs.classificationCode, { x: cx + 2, y, size: FONT_SIZES.SMALL, font: fonts.helveticaBold, color: codeColour })
    cx += COL_WIDTHS[1] ?? 35

    // Observation text (truncated)
    const obsText = (obs.observationText ?? '').substring(0, 60)
    page.drawText(obsText, { x: cx + 2, y, size: FONT_SIZES.SMALL, font: fonts.helvetica, color: COLOURS.TEXT })
    cx += COL_WIDTHS[2] ?? 220

    // Location
    page.drawText((obs.location ?? '').substring(0, 15), { x: cx + 2, y, size: FONT_SIZES.SMALL, font: fonts.helvetica, color: COLOURS.TEXT })
    cx += COL_WIDTHS[3] ?? 65

    // Regulation
    page.drawText((obs.regulationReference ?? '').substring(0, 18), { x: cx + 2, y, size: FONT_SIZES.SMALL, font: fonts.helvetica, color: COLOURS.MUTED })
    cx += COL_WIDTHS[4] ?? 80

    // Remedial
    page.drawText((obs.remedialAction ?? '').substring(0, 20), { x: cx + 2, y, size: FONT_SIZES.SMALL, font: fonts.helvetica, color: COLOURS.TEXT })

    y -= ROW_H
  }

  // Summary counts
  y -= 8
  const c1 = observations.filter((o) => o.classificationCode === 'C1').length
  const c2 = observations.filter((o) => o.classificationCode === 'C2').length
  const c3 = observations.filter((o) => o.classificationCode === 'C3').length
  const fi = observations.filter((o) => o.classificationCode === 'FI').length

  page.drawText(`Summary: C1: ${c1}  |  C2: ${c2}  |  C3: ${c3}  |  FI: ${fi}  |  Total: ${observations.length}`, {
    x,
    y,
    size: FONT_SIZES.SMALL,
    font: fonts.helveticaBold,
    color: COLOURS.TEXT,
  })

  drawPageFooter(page, pageNum, fonts)
  return pageNum + 1
}

// ============================================================
// DYNAMIC PAGES: INSPECTION SCHEDULE
// ============================================================

function drawInspectionPages(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
  startPage: number,
): number {
  const items = cert.inspectionSchedule
  if (items.length === 0) return startPage

  let page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
  let pageNum = startPage
  drawPageHeader(page, cert.reportNumber, fonts)

  const x = MARGIN
  const ROW_H = 13
  let y = PAGE.HEIGHT - MARGIN - 40

  y = drawSectionHeader(page, 'SCHEDULE OF INSPECTIONS', x, y, CONTENT_W, fonts)

  let currentSection = -1

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    if (needsNewPage(y)) {
      drawPageFooter(page, pageNum, fonts)
      page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
      pageNum++
      drawPageHeader(page, cert.reportNumber, fonts)
      y = PAGE.HEIGHT - MARGIN - 40
      y = drawSectionHeader(page, 'SCHEDULE OF INSPECTIONS (continued)', x, y, CONTENT_W, fonts)
    }

    // Section divider
    if (item.section !== currentSection) {
      currentSection = item.section
      y -= 4
      page.drawText(item.sectionTitle, {
        x,
        y,
        size: FONT_SIZES.SMALL,
        font: fonts.helveticaBold,
        color: COLOURS.ACCENT,
      })
      y -= ROW_H
    }

    // Item ref + description
    page.drawText(item.itemRef, {
      x,
      y,
      size: FONT_SIZES.SMALL,
      font: fonts.helvetica,
      color: COLOURS.MUTED,
    })

    const desc = (item.description ?? '').substring(0, 70)
    page.drawText(desc, {
      x: x + 40,
      y,
      size: FONT_SIZES.SMALL,
      font: fonts.helvetica,
      color: COLOURS.TEXT,
    })

    // Outcome (right aligned)
    const outcome = item.outcome ?? '—'
    const outcomeColour =
      outcome === 'PASS' ? COLOURS.PASS
        : outcome === 'C1' ? COLOURS.FAIL
          : outcome === 'C2' ? COLOURS.AMBER
            : COLOURS.MUTED

    const outcomeText = outcome === 'PASS' ? '✓' : outcome
    const ow = fonts.helveticaBold.widthOfTextAtSize(outcomeText, FONT_SIZES.SMALL)
    page.drawText(outcomeText, {
      x: x + CONTENT_W - ow - 4,
      y,
      size: FONT_SIZES.SMALL,
      font: fonts.helveticaBold,
      color: outcomeColour,
    })

    y -= ROW_H
  }

  drawPageFooter(page, pageNum, fonts)
  return pageNum + 1
}

// ============================================================
// DYNAMIC PAGES: CIRCUIT SCHEDULE
// ============================================================

function drawCircuitPages(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
  startPage: number,
): number {
  const circuits = cert.circuits
  if (circuits.length === 0) return startPage

  let page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
  let pageNum = startPage
  drawPageHeader(page, cert.reportNumber, fonts)

  const x = MARGIN
  const ROW_H = 12
  const HALF_ROW_H = 11
  let y = PAGE.HEIGHT - MARGIN - 40

  y = drawSectionHeader(page, 'SCHEDULE OF CIRCUIT DETAILS AND TEST RESULTS', x, y, CONTENT_W, fonts)

  // Test instruments
  const ti = cert.testInstruments
  if (ti.multifunctionInstrument) {
    page.drawText(`Instruments: ${ti.multifunctionInstrument}`, {
      x,
      y,
      size: 7,
      font: fonts.helvetica,
      color: COLOURS.MUTED,
    })
    y -= ROW_H
  }

  // Group by board
  const boards = cert.distributionBoards
  let currentBoardIdx = 0

  for (const board of boards) {
    const boardCircuits = circuits.filter((c) => c.dbId === board.id)
    if (boardCircuits.length === 0) continue

    if (needsNewPage(y)) {
      drawPageFooter(page, pageNum, fonts)
      page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
      pageNum++
      drawPageHeader(page, cert.reportNumber, fonts)
      y = PAGE.HEIGHT - MARGIN - 40
    }

    // Board header
    y -= 4
    page.drawRectangle({
      x,
      y: y - 10,
      width: CONTENT_W,
      height: 16,
      color: COLOURS.HEADER_BG,
    })
    page.drawText(`DB: ${board.dbReference} — ${board.dbLocation}  |  Zs at DB: ${board.zsAtDb ?? '—'}Ω  |  Ipf: ${board.ipfAtDb ?? '—'} kA`, {
      x: x + 4,
      y: y - 6,
      size: FONT_SIZES.SMALL,
      font: fonts.helveticaBold,
      color: COLOURS.HEADER_TEXT,
    })
    y -= 22

    // Column headers — Row 1 (identity)
    const row1Headers = ['Cct', 'Description', 'Type', 'Ref', 'Pts', 'Live', 'CPC', 'OCPD', 'Rating', 'RCD', 'IΔn']
    const row1Widths = [28, 90, 24, 22, 24, 28, 28, 32, 34, 28, 28]

    let hx = x
    row1Headers.forEach((h, i) => {
      const w = row1Widths[i]
      if (!w) return
      page.drawText(h, { x: hx + 1, y, size: 6.5, font: fonts.helveticaBold, color: COLOURS.HEADER_TEXT })
      hx += w
    })
    y -= HALF_ROW_H

    // Column headers — Row 2 (test results)
    const row2Headers = ['r1', 'rn', 'r2', 'R1+R2', 'IR V', 'IR L-L', 'IR L-E', 'Zs', 'Pol', 'RCD ms', 'Rmks']
    const row2Widths = [28, 28, 28, 36, 30, 36, 36, 34, 26, 38, 46]

    hx = x
    row2Headers.forEach((h, i) => {
      const w = row2Widths[i]
      if (!w) return
      page.drawText(h, { x: hx + 1, y, size: 6.5, font: fonts.helveticaBold, color: COLOURS.MUTED })
      hx += w
    })
    y -= HALF_ROW_H

    // Divider
    page.drawLine({
      start: { x, y: y + 2 },
      end: { x: x + CONTENT_W, y: y + 2 },
      thickness: 0.5,
      color: COLOURS.LINE,
    })
    y -= 2

    // Circuit rows
    for (let ci = 0; ci < boardCircuits.length; ci++) {
      const c = boardCircuits[ci]
      if (!c) continue

      if (needsNewPage(y)) {
        drawPageFooter(page, pageNum, fonts)
        page = pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT])
        pageNum++
        drawPageHeader(page, cert.reportNumber, fonts)
        y = PAGE.HEIGHT - MARGIN - 40
        y = drawSectionHeader(page, `CIRCUIT SCHEDULE (continued) — ${board.dbReference}`, x, y, CONTENT_W, fonts)
      }

      const fmtVal = (v: number | string | null | undefined): string => {
        if (v == null) return '—'
        return String(v)
      }

      // Row 1: identity
      let rx = x
      const r1Vals = [
        c.circuitNumber, (c.circuitDescription ?? '').substring(0, 18),
        c.wiringType ?? '—', c.referenceMethod ?? '—',
        fmtVal(c.numberOfPoints), fmtVal(c.liveConductorCsa),
        fmtVal(c.cpcCsa), `${c.ocpdType ?? ''}${c.ocpdRating ?? ''}`,
        c.ocpdBsEn ? c.ocpdBsEn.substring(0, 6) : '—',
        c.rcdType ?? '—', fmtVal(c.rcdRating),
      ]

      r1Vals.forEach((v, i) => {
        const w = row1Widths[i]
        if (!w) return
        page.drawText(String(v).substring(0, 12), { x: rx + 1, y, size: 6.5, font: fonts.helvetica, color: COLOURS.TEXT })
        rx += w
      })
      y -= ROW_H

      // Row 2: test results
      rx = x
      const r2Vals = [
        fmtVal(c.r1), fmtVal(c.rn), fmtVal(c.r2), fmtVal(c.r1r2),
        fmtVal(c.irTestVoltage), fmtVal(c.irLiveLive), fmtVal(c.irLiveEarth),
        fmtVal(c.zs),
        c.polarity === 'TICK' ? '✓' : c.polarity === 'CROSS' ? '✗' : '—',
        fmtVal(c.rcdDisconnectionTime),
        (c.remarks ?? '').substring(0, 12),
      ]

      r2Vals.forEach((v, i) => {
        const w = row2Widths[i]
        if (!w) return
        // Highlight Zs if exceeded
        const isZs = i === 7
        const zsExceeded = isZs && c.zs != null && c.maxPermittedZs != null && c.zs > c.maxPermittedZs
        const colour = zsExceeded ? COLOURS.FAIL : COLOURS.MUTED

        page.drawText(String(v), { x: rx + 1, y, size: 6.5, font: fonts.helvetica, color: colour })
        rx += w
      })
      y -= ROW_H

      // Thin separator between circuits
      page.drawLine({
        start: { x, y: y + 4 },
        end: { x: x + CONTENT_W, y: y + 4 },
        thickness: 0.25,
        color: COLOURS.LINE,
      })
    }

    currentBoardIdx++
  }

  drawPageFooter(page, pageNum, fonts)
  return pageNum + 1
}

// ============================================================
// TEXT SPLITTING HELPER
// ============================================================

function splitTextToLines(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
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

// ============================================================
// MAIN GENERATOR
// ============================================================

/**
 * Generate a complete EICR PDF from certificate data.
 * Returns raw bytes — use downloadEICRPdf() for browser download.
 */
export async function generateEICRPdf(cert: EICRCertificate): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()

  // Embed standard fonts
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fonts: FontSet = { helvetica, helveticaBold }

  // PDF metadata
  pdfDoc.setTitle(`EICR Report ${cert.reportNumber}`)
  pdfDoc.setAuthor(cert.declaration.inspectorName || 'CertVoice')
  pdfDoc.setSubject('Electrical Installation Condition Report')
  pdfDoc.setCreator('CertVoice — certvoice.co.uk')
  pdfDoc.setCreationDate(new Date())

  // Page 1: Sections A-D
  drawClientInstallationPage(pdfDoc, cert, fonts)

  // Fetch signatures (graceful fallback if offline)
  const [inspSig, qsSig] = await Promise.all([
    cert.declaration.inspectorSignatureKey
      ? fetchSignaturePng(cert.declaration.inspectorSignatureKey)
      : Promise.resolve(null),
    cert.declaration.qsSignatureKey
      ? fetchSignaturePng(cert.declaration.qsSignatureKey)
      : Promise.resolve(null),
  ])

  // Page 2: Sections E-G (declaration + signatures)
  await drawDeclarationPage(pdfDoc, cert, fonts, { inspector: inspSig, qs: qsSig })

  // Page 3: Sections I-J
  drawSupplyPage(pdfDoc, cert, fonts)

  // Dynamic pages
  let nextPage = 4

  // Observations
  nextPage = drawObservationsPages(pdfDoc, cert, fonts, nextPage)

  // Inspection schedule
  nextPage = drawInspectionPages(pdfDoc, cert, fonts, nextPage)

  // Circuit schedule
  drawCircuitPages(pdfDoc, cert, fonts, nextPage)

  // Serialize
  const pdfBytes = await pdfDoc.save()
  return pdfBytes
}

// ============================================================
// BROWSER DOWNLOAD
// ============================================================

/**
 * Generate and trigger browser download of the EICR PDF.
 */
export async function downloadEICRPdf(cert: EICRCertificate): Promise<void> {
  const pdfBytes = await generateEICRPdf(cert)

  // Copy to plain ArrayBuffer for Blob compatibility
  const buffer = new ArrayBuffer(pdfBytes.byteLength)
  new Uint8Array(buffer).set(pdfBytes)

  const blob = new Blob([buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `EICR-${cert.reportNumber || cert.id}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  URL.revokeObjectURL(url)
}
