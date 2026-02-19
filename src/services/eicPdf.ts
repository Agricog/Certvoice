/**
 * CertVoice — EIC PDF Generator
 *
 * Client-side PDF generation using pdf-lib + shared pdfStyles helpers.
 * Produces a multi-page PDF matching BS 7671 Model Form 1
 * (Electrical Installation Certificate).
 *
 * Sections:
 *   A — Client Details
 *   B — Installation Details
 *   C — Extent of Work
 *   D — Design Details
 *   E — Departures from BS 7671
 *   F — Declarations (Designer, Constructor, Inspector)
 *   G — Part P Notification
 *   H — Comments on Existing Installation
 *   Supply & Installation Particulars
 *   Test Instruments
 *   Inspection Schedule (by section)
 *   Circuit Schedule (per distribution board)
 *
 * @module services/eicPdf
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib'
import type {
  EICCertificate,
  Departure,
  DesignDetails,
  EICDeclarations,
  PartPNotification,
  ExistingInstallationComments,
  SupplyCharacteristics,
  InstallationParticulars,
  DistributionBoardHeader,
  CircuitDetail,
  TestInstruments,
  InspectionItem,
} from '../types/eic'
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

function n(val: unknown, unit = ''): string {
  if (val == null || val === '') return '--'
  return `${val}${unit}`
}

function yn(val: unknown): string {
  if (val === true) return 'Yes'
  if (val === false) return 'No'
  return '--'
}

function earthingLabel(type: string | null | undefined): string {
  if (!type) return '--'
  const map: Record<string, string> = {
    TN_C: 'TN-C', TN_S: 'TN-S', TN_C_S: 'TN-C-S', TT: 'TT', IT: 'IT',
  }
  return map[type] || type
}

function workExtentLabel(val: string | null | undefined): string {
  if (!val) return '--'
  const map: Record<string, string> = {
    NEW_INSTALLATION: 'New Installation',
    ADDITION: 'Addition to Existing',
    ALTERATION: 'Alteration to Existing',
    NEW_AND_ADDITION: 'New Installation + Addition',
    OTHER: 'Other',
  }
  return map[val] || val
}

function premisesLabel(val: string | null | undefined): string {
  if (!val) return '--'
  const map: Record<string, string> = {
    DOMESTIC: 'Domestic', COMMERCIAL: 'Commercial', INDUSTRIAL: 'Industrial',
    OTHER: 'Other', AGRICULTURAL: 'Agricultural', CARAVAN: 'Caravan',
  }
  return map[val] || val
}

function conductorConfigLabel(val: string | null | undefined): string {
  if (!val) return '--'
  const map: Record<string, string> = {
    '1PH_2WIRE': '1Φ 2-wire', '1PH_3WIRE': '1Φ 3-wire',
    '3PH_3WIRE': '3Φ 3-wire', '3PH_4WIRE': '3Φ 4-wire',
  }
  return map[val] || val
}

function bondingLabel(val: string | null | undefined): string {
  if (!val || val === 'NA') return 'N/A'
  return val === 'YES' ? '✓' : val === 'NO' ? '✗' : val
}

// ── Page header ─────────────────────────────────────────────────

function drawEICHeader(
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

  page.drawText('ELECTRICAL INSTALLATION CERTIFICATE', {
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

// ── Circuit table ───────────────────────────────────────────────

const CIRCUIT_COLS = [
  { label: 'No.', width: 22 },
  { label: 'Description', width: 68 },
  { label: 'OCPD\nType', width: 26 },
  { label: 'OCPD\nRating', width: 26 },
  { label: 'CSA\nmm²', width: 24 },
  { label: 'CPC\nmm²', width: 24 },
  { label: 'R1+R2\nΩ', width: 30 },
  { label: 'IR\nL-E MΩ', width: 30 },
  { label: 'IR\nL-N MΩ', width: 30 },
  { label: 'Zs\nΩ', width: 28 },
  { label: 'RCD\nms', width: 26 },
  { label: 'Pol', width: 20 },
  { label: 'Remarks', width: 66 },
]

const ROW_HEIGHT = 12
const HEADER_HEIGHT = 22

function drawCircuitTableHeader(page: PDFPage, fonts: FontSet, y: number): number {
  let x = PAGE.marginLeft

  // Header background
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - HEADER_HEIGHT,
    width: CONTENT_WIDTH,
    height: HEADER_HEIGHT,
    color: COLOURS.headerBg,
  })

  for (const col of CIRCUIT_COLS) {
    const lines = col.label.split('\n')
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: x + 2,
        y: y - 8 - (i * 8),
        size: 5.5,
        font: fonts.bold,
        color: COLOURS.white,
      })
    })
    x += col.width
  }

  return y - HEADER_HEIGHT
}

function drawCircuitRow(
  page: PDFPage,
  fonts: FontSet,
  y: number,
  c: CircuitDetail,
  rowIndex: number,
): number {
  // Alternate row background
  if (rowIndex % 2 === 1) {
    page.drawRectangle({
      x: PAGE.marginLeft,
      y: y - ROW_HEIGHT,
      width: CONTENT_WIDTH,
      height: ROW_HEIGHT,
      color: COLOURS.rowAlt,
    })
  }

  const values = [
    s(c.circuitNumber),
    s(c.circuitDescription),
    s(c.ocpdType),
    n(c.ocpdRating, 'A'),
    n(c.liveConductorCsa),
    n(c.cpcCsa),
    n(c.r1r2),
    n(c.irLiveEarth),
    n(c.irLiveLive),
    n(c.zs),
    c.rcdDisconnectionTime != null ? `${c.rcdDisconnectionTime}` : '--',
    c.polarity === 'CORRECT' ? '✓' : c.polarity === 'NA' ? '--' : s(c.polarity),
    s(c.remarks),
  ]

  let x = PAGE.marginLeft
  values.forEach((val, i) => {
    const col = CIRCUIT_COLS[i]!
    // Truncate if too wide
    let text = val
    const maxW = col.width - 4
    while (fonts.regular.widthOfTextAtSize(text, 5.5) > maxW && text.length > 1) {
      text = text.slice(0, -1)
    }
    page.drawText(text, {
      x: x + 2,
      y: y - 9,
      size: 5.5,
      font: fonts.regular,
      color: COLOURS.text,
    })
    x += col.width
  })

  return y - ROW_HEIGHT
}

// ── Declaration block ───────────────────────────────────────────

function drawDeclarationBlock(
  page: PDFPage,
  fonts: FontSet,
  y: number,
  title: string,
  declText: string,
  decl: { name: string; companyName: string; companyAddress: string; position: string; registrationNumber: string; schemeBody: string | null; dateSigned: string },
): number {
  // Title
  page.drawText(title, {
    x: PAGE.marginLeft + 2,
    y,
    size: FONT.label + 1,
    font: fonts.bold,
    color: COLOURS.accent,
  })
  y -= 10

  // Declaration text
  const lines = wrapText(declText, fonts.regular, FONT.label, CONTENT_WIDTH - 4)
  for (const line of lines) {
    page.drawText(line, {
      x: PAGE.marginLeft + 2,
      y,
      size: FONT.label,
      font: fonts.regular,
      color: COLOURS.muted,
    })
    y -= 8
  }
  y -= 2

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Name', value: s(decl.name) },
    { label: 'Position', value: s(decl.position) },
  )
  y = drawField(page, fonts.regular, fonts.bold, y, 'Company', s(decl.companyName))
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Registration No.', value: s(decl.registrationNumber) },
    { label: 'Scheme Body', value: s(decl.schemeBody) },
  )
  y = drawField(page, fonts.regular, fonts.bold, y, 'Date Signed', s(decl.dateSigned))

  return y
}

// ── Main generator ──────────────────────────────────────────────

export async function generateEICPdf(cert: EICCertificate): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fonts: FontSet = { regular, bold }

  pdfDoc.setTitle('Electrical Installation Certificate')
  pdfDoc.setAuthor(cert.declarations?.designer?.name || 'CertVoice')
  pdfDoc.setSubject('Electrical Installation Certificate per BS 7671')
  pdfDoc.setCreator('CertVoice - certvoice.co.uk')
  pdfDoc.setCreationDate(new Date())

  let page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let pageNum = 1
  let y = drawEICHeader(page, fonts, cert.id, pageNum)

  // Helper: check page space, add new page if needed
  function ensureSpace(requiredHeight: number) {
    if (needsNewPage(y, requiredHeight)) {
      drawPageFooter(page, fonts.regular)
      page = pdfDoc.addPage([PAGE.width, PAGE.height])
      pageNum++
      y = drawEICHeader(page, fonts, cert.id, pageNum)
    }
  }

  // ═════════════════════════════════════════════════════════════
  // SECTION A: CLIENT DETAILS
  // ═════════════════════════════════════════════════════════════
  y = drawSectionHeader(page, fonts.bold, y, 'Section A — Client Details')

  y = drawField(page, fonts.regular, fonts.bold, y, 'Client', s(cert.clientDetails?.clientName))
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Client Address', s(cert.clientDetails?.clientAddress))
  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // SECTION B: INSTALLATION DETAILS
  // ═════════════════════════════════════════════════════════════
  ensureSpace(60)
  y = drawSectionHeader(page, fonts.bold, y, 'Section B — Installation Details')

  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Installation Address', s(cert.installationDetails?.installationAddress))
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Occupier', value: s(cert.installationDetails?.occupier) },
    { label: 'Premises Type', value: premisesLabel(cert.installationDetails?.premisesType) },
  )
  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // SECTION C: EXTENT OF WORK
  // ═════════════════════════════════════════════════════════════
  const extent = cert.extentOfWork
  ensureSpace(80)
  y = drawSectionHeader(page, fonts.bold, y, 'Section C — Extent of Work')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Work Extent', value: workExtentLabel(extent?.workExtent) },
    { label: 'Date Commenced', value: s(extent?.dateCommenced) },
  )
  y = drawField(page, fonts.regular, fonts.bold, y, 'Date Completed', s(extent?.dateCompleted))
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Description of Work', s(extent?.descriptionOfWork))
  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // SECTION D: DESIGN DETAILS
  // ═════════════════════════════════════════════════════════════
  const design: DesignDetails | undefined = cert.design
  ensureSpace(100)
  y = drawSectionHeader(page, fonts.bold, y, 'Section D — Design Details')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Max Demand', value: design?.maxDemand != null ? `${design.maxDemand} ${design.maxDemandUnit ?? 'A'}` : '--' },
    { label: 'Phases', value: design?.numberOfPhases ? `${design.numberOfPhases}` : '--' },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'OCPD Characteristics Appropriate', value: yn(design?.ocpdCharacteristicsAppropriate) },
    { label: 'Circuits Adequately Sized', value: yn(design?.circuitsAdequatelySized) },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Disconnection Times Achievable', value: yn(design?.disconnectionTimesAchievable) },
    { label: 'SPD Assessment Done', value: yn(design?.spdAssessmentDone) },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'SPD Required', value: yn(design?.spdRequired) },
    { label: 'SPD Fitted', value: yn(design?.spdFitted) },
  )
  if (design?.energyEfficiencyDetails) {
    y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Energy Efficiency (Reg 132.19)', s(design.energyEfficiencyDetails))
  }
  if (design?.designComments) {
    y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Design Comments', s(design.designComments))
  }
  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // SECTION E: DEPARTURES FROM BS 7671
  // ═════════════════════════════════════════════════════════════
  const departures: Departure[] = cert.departures ?? []
  ensureSpace(40)
  y = drawSectionHeader(page, fonts.bold, y, 'Section E — Departures from BS 7671')

  if (departures.length === 0) {
    y = drawField(page, fonts.regular, fonts.bold, y, '', 'No departures from BS 7671')
  } else {
    for (const dep of departures) {
      ensureSpace(50)
      y = drawFieldPair(page, fonts.regular, fonts.bold, y,
        { label: `${dep.itemNumber}. Regulation`, value: s(dep.regulationReference) },
        { label: 'Agreed By', value: s(dep.agreedBy) },
      )
      y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Description', s(dep.description))
      y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Justification', s(dep.justification))
      drawHorizontalRule(page, y + 2, COLOURS.borderLight)
      y -= 4
    }
  }
  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // SECTION F: DECLARATIONS
  // ═════════════════════════════════════════════════════════════
  const decl: EICDeclarations | undefined = cert.declarations
  ensureSpace(140)
  y = drawSectionHeader(page, fonts.bold, y, 'Section F — Declarations')

  if (decl?.samePersonAllRoles) {
    page.drawText('All three roles (Designer, Constructor, Inspector) fulfilled by the same person.', {
      x: PAGE.marginLeft + 2,
      y,
      size: FONT.label,
      font: fonts.regular,
      color: COLOURS.muted,
    })
    y -= 12
  }

  // Designer
  ensureSpace(90)
  y = drawDeclarationBlock(page, fonts, y,
    'Designer',
    'I/We, being the person(s) responsible for the design of the electrical installation, declare that the design work complies with BS 7671 (IET Wiring Regulations), and any departures are detailed in Section E.',
    {
      name: decl?.designer?.name ?? '',
      companyName: decl?.designer?.companyName ?? '',
      companyAddress: decl?.designer?.companyAddress ?? '',
      position: decl?.designer?.position ?? '',
      registrationNumber: decl?.designer?.registrationNumber ?? '',
      schemeBody: decl?.designer?.schemeBody ?? null,
      dateSigned: decl?.designer?.dateSigned ?? '',
    },
  )
  y -= 6
  drawHorizontalRule(page, y + 2, COLOURS.borderLight)
  y -= 4

  // Constructor
  ensureSpace(90)
  y = drawDeclarationBlock(page, fonts, y,
    'Constructor',
    'I/We, being the person(s) responsible for the construction of the electrical installation, declare that the work has been constructed in accordance with BS 7671 and the design provided.',
    {
      name: decl?.constructor?.name ?? '',
      companyName: decl?.constructor?.companyName ?? '',
      companyAddress: decl?.constructor?.companyAddress ?? '',
      position: decl?.constructor?.position ?? '',
      registrationNumber: decl?.constructor?.registrationNumber ?? '',
      schemeBody: decl?.constructor?.schemeBody ?? null,
      dateSigned: decl?.constructor?.dateSigned ?? '',
    },
  )
  y -= 6
  drawHorizontalRule(page, y + 2, COLOURS.borderLight)
  y -= 4

  // Inspector
  ensureSpace(100)
  y = drawDeclarationBlock(page, fonts, y,
    'Inspector',
    'I/We, being the person(s) responsible for the inspection and testing of the electrical installation, declare that the work has been inspected and tested in accordance with BS 7671.',
    {
      name: decl?.inspector?.name ?? '',
      companyName: decl?.inspector?.companyName ?? '',
      companyAddress: decl?.inspector?.companyAddress ?? '',
      position: decl?.inspector?.position ?? '',
      registrationNumber: decl?.inspector?.registrationNumber ?? '',
      schemeBody: decl?.inspector?.schemeBody ?? null,
      dateSigned: decl?.inspector?.dateSigned ?? '',
    },
  )

  // QS details if different from inspector
  if (decl?.inspector?.qsName) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Qualified Supervisor', value: s(decl.inspector.qsName) },
      { label: 'QS Date Signed', value: s(decl.inspector.qsDateSigned) },
    )
  }

  y = drawField(page, fonts.regular, fonts.bold, y, 'Date Inspected', s(decl?.inspector?.dateInspected))
  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // SECTION G: PART P NOTIFICATION
  // ═════════════════════════════════════════════════════════════
  const partP: PartPNotification | undefined = cert.partPNotification
  ensureSpace(50)
  y = drawSectionHeader(page, fonts.bold, y, 'Section G — Part P Building Regulations')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Notifiable Work', value: yn(partP?.isNotifiable) },
    { label: 'Notification Submitted', value: yn(partP?.notificationSubmitted) },
  )

  if (partP?.isNotifiable) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Reference', value: s(partP.notificationReference) },
      { label: 'Date Submitted', value: s(partP.dateSubmitted) },
    )
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Scheme Body', value: s(partP.schemeBody) },
      { label: 'Building Control Body', value: s(partP.buildingControlBody) },
    )
  }

  if (partP?.notes) {
    y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Notes', s(partP.notes))
  }

  // Part P notification banner
  if (partP?.isNotifiable) {
    ensureSpace(30)
    y -= 4

    page.drawRectangle({
      x: PAGE.marginLeft,
      y: y - 18,
      width: CONTENT_WIDTH,
      height: 22,
      color: COLOURS.rowAlt,
    })

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

    const notifStatus = partP.notificationSubmitted
      ? `Submitted ${partP.dateSubmitted || ''} — Ref: ${partP.notificationReference || 'pending'}`
      : 'Not yet submitted — notify via scheme provider portal'

    page.drawText(notifStatus, {
      x: PAGE.marginLeft + 8,
      y: y - 15,
      size: FONT.small,
      font: fonts.regular,
      color: COLOURS.muted,
    })

    y -= 24
  }

  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // SECTION H: COMMENTS ON EXISTING INSTALLATION
  // ═════════════════════════════════════════════════════════════
  const existing: ExistingInstallationComments | undefined = cert.existingInstallation
  const hasExistingComments = existing && (existing.generalCondition || existing.defectsObserved || existing.recommendations)

  if (hasExistingComments) {
    ensureSpace(60)
    y = drawSectionHeader(page, fonts.bold, y, 'Section H — Comments on Existing Installation')

    if (existing.generalCondition) {
      y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'General Condition', s(existing.generalCondition))
    }
    if (existing.defectsObserved) {
      y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Defects Observed', s(existing.defectsObserved))
    }
    if (existing.recommendations) {
      y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Recommendations', s(existing.recommendations))
    }
    y -= SPACING.sectionGap
  }

  // ═════════════════════════════════════════════════════════════
  // SUPPLY CHARACTERISTICS
  // ═════════════════════════════════════════════════════════════
  const supply: SupplyCharacteristics | undefined = cert.supplyCharacteristics
  ensureSpace(80)
  y = drawSectionHeader(page, fonts.bold, y, 'Supply Characteristics & Earthing Arrangements')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Earthing System', value: earthingLabel(supply?.earthingType) },
    { label: 'Supply Type', value: s(supply?.supplyType) },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Conductor Config', value: conductorConfigLabel(supply?.conductorConfig) },
    { label: 'Nominal Voltage', value: n(supply?.nominalVoltage, 'V') },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Nominal Frequency', value: n(supply?.nominalFrequency, 'Hz') },
    { label: 'Supply Polarity', value: supply?.supplyPolarityConfirmed ? 'Confirmed ✓' : 'Not confirmed' },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Ze', value: n(supply?.ze, ' Ω') },
    { label: 'Ipf', value: n(supply?.ipf, ' kA') },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Supply Device BS/EN', value: s(supply?.supplyDeviceBsEn) },
    { label: 'Supply Device Rating', value: n(supply?.supplyDeviceRating, 'A') },
  )
  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // INSTALLATION PARTICULARS
  // ═════════════════════════════════════════════════════════════
  const particulars: InstallationParticulars | undefined = cert.installationParticulars
  ensureSpace(80)
  y = drawSectionHeader(page, fonts.bold, y, 'Installation Particulars')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Main Switch Location', value: s(particulars?.mainSwitchLocation) },
    { label: 'Main Switch BS/EN', value: s(particulars?.mainSwitchBsEn) },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Main Switch Rating', value: n(particulars?.mainSwitchCurrentRating, 'A') },
    { label: 'Poles', value: n(particulars?.mainSwitchPoles) },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Earthing Conductor CSA', value: n(particulars?.earthingConductorCsa, ' mm²') },
    { label: 'Bonding Conductor CSA', value: n(particulars?.bondingConductorCsa, ' mm²') },
  )

  // Bonding connections
  const bondingItems = [
    `Water: ${bondingLabel(particulars?.bondingWater)}`,
    `Gas: ${bondingLabel(particulars?.bondingGas)}`,
    `Oil: ${bondingLabel(particulars?.bondingOil)}`,
    `Steel: ${bondingLabel(particulars?.bondingSteel)}`,
    `Lightning: ${bondingLabel(particulars?.bondingLightning)}`,
    `Other: ${bondingLabel(particulars?.bondingOther)}`,
  ].join('   ')
  y = drawField(page, fonts.regular, fonts.bold, y, 'Main Bonding', bondingItems)

  if (particulars?.installationElectrode) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Earth Electrode Type', value: s(particulars.electrodeType) },
      { label: 'Electrode Resistance', value: n(particulars.electrodeResistance, ' Ω') },
    )
  }

  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // TEST INSTRUMENTS
  // ═════════════════════════════════════════════════════════════
  const instruments: TestInstruments | undefined = cert.testInstruments
  ensureSpace(50)
  y = drawSectionHeader(page, fonts.bold, y, 'Test Instruments')

  if (instruments?.multifunctionInstrument) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Multifunction Tester', value: `${s(instruments.multifunctionInstrument.make)} ${s(instruments.multifunctionInstrument.model)}` },
      { label: 'Serial No.', value: s(instruments.multifunctionInstrument.serialNumber) },
    )
    y = drawField(page, fonts.regular, fonts.bold, y, 'Calibration Date', s(instruments.multifunctionInstrument.calibrationDate))
  }

  if (instruments?.continuityTester && instruments.continuityTester.make) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Continuity Tester', value: `${s(instruments.continuityTester.make)} ${s(instruments.continuityTester.model)}` },
      { label: 'Serial No.', value: s(instruments.continuityTester.serialNumber) },
    )
  }

  if (instruments?.insulationTester && instruments.insulationTester.make) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Insulation Tester', value: `${s(instruments.insulationTester.make)} ${s(instruments.insulationTester.model)}` },
      { label: 'Serial No.', value: s(instruments.insulationTester.serialNumber) },
    )
  }

  if (instruments?.rcdTester && instruments.rcdTester.make) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'RCD Tester', value: `${s(instruments.rcdTester.make)} ${s(instruments.rcdTester.model)}` },
      { label: 'Serial No.', value: s(instruments.rcdTester.serialNumber) },
    )
  }

  y -= SPACING.sectionGap

  // ═════════════════════════════════════════════════════════════
  // SCHEDULE OF INSPECTIONS
  // ═════════════════════════════════════════════════════════════
  const inspectionItems: InspectionItem[] = cert.inspectionSchedule ?? []

  if (inspectionItems.length > 0) {
    ensureSpace(40)
    y = drawSectionHeader(page, fonts.bold, y, 'Schedule of Inspections')

    // Group by section
    const sections = new Map<string, InspectionItem[]>()
    for (const item of inspectionItems) {
      const sec = item.section ?? 'General'
      if (!sections.has(sec)) sections.set(sec, [])
      sections.get(sec)!.push(item)
    }

    const SECTION_LABELS: Record<string, string> = {
      '1': 'Distribution Equipment',
      '2': 'Earthing & Bonding',
      '3': 'Wiring System',
      '4': 'Current-Using Equipment',
      '5': 'Electric Shock Protection',
      '6': 'Isolation & Switching',
      '7': 'Thermal Effects',
      '8': 'Special Locations',
    }

    for (const [sec, items] of sections) {
      ensureSpace(30)

      const sectionTitle = SECTION_LABELS[sec] ?? `Section ${sec}`
      page.drawText(sectionTitle, {
        x: PAGE.marginLeft + 2,
        y,
        size: FONT.label + 0.5,
        font: fonts.bold,
        color: COLOURS.text,
      })
      y -= 10

      for (const item of items) {
        ensureSpace(12)

        const outcomeText = item.outcome ?? '--'
        const outcomeColor = outcomeText === 'PASS' ? COLOURS.pass
          : (outcomeText === 'C1' || outcomeText === 'C2') ? COLOURS.c1
          : outcomeText === 'C3' ? COLOURS.c2
          : COLOURS.muted

        // Outcome badge
        const badgeW = fonts.bold.widthOfTextAtSize(outcomeText, 6) + 6
        page.drawRectangle({
          x: PAGE.marginLeft + 2,
          y: y - 7,
          width: badgeW,
          height: 9,
          color: rgb(outcomeColor.red * 0.15, outcomeColor.green * 0.15, outcomeColor.blue * 0.15),
        })
        page.drawText(outcomeText, {
          x: PAGE.marginLeft + 5,
          y: y - 5,
          size: 6,
          font: fonts.bold,
          color: outcomeColor,
        })

        // Item ref + description
        const descText = `${item.itemRef ?? ''} ${item.description ?? ''}`
        const maxDescW = CONTENT_WIDTH - badgeW - 12
        let desc = descText
        while (fonts.regular.widthOfTextAtSize(desc, FONT.small) > maxDescW && desc.length > 1) {
          desc = desc.slice(0, -1)
        }

        page.drawText(desc, {
          x: PAGE.marginLeft + badgeW + 8,
          y: y - 5,
          size: FONT.small,
          font: fonts.regular,
          color: COLOURS.text,
        })

        y -= 10
      }

      y -= 4
    }

    y -= SPACING.sectionGap
  }

  // ═════════════════════════════════════════════════════════════
  // CIRCUIT SCHEDULE (per board)
  // ═════════════════════════════════════════════════════════════
  const boards: DistributionBoardHeader[] = cert.distributionBoards ?? []
  const circuits: CircuitDetail[] = cert.circuits ?? []

  for (const board of boards) {
    const boardCircuits = circuits.filter((c) => {
      const cDbId = (c as Record<string, unknown>).dbId ?? (c as Record<string, unknown>).dbReference
      return cDbId === board.dbReference || cDbId === board.id
    })

    if (boardCircuits.length === 0) continue

    ensureSpace(60)
    y = drawSectionHeader(page, fonts.bold, y,
      `Circuit Schedule — ${board.dbReference}${board.dbLocation ? ` (${board.dbLocation})` : ''}`,
    )

    // Board details line
    const boardInfo = [
      board.dbMake ? `Make: ${board.dbMake}` : null,
      board.dbType ? `Type: ${board.dbType}` : null,
      board.zeAtBoard != null ? `Ze: ${board.zeAtBoard}Ω` : null,
      board.zdb != null ? `Zdb: ${board.zdb}Ω` : null,
    ].filter(Boolean).join('  |  ')

    if (boardInfo) {
      page.drawText(boardInfo, {
        x: PAGE.marginLeft + 2,
        y,
        size: FONT.small,
        font: fonts.regular,
        color: COLOURS.muted,
      })
      y -= 10
    }

    // Table header
    y = drawCircuitTableHeader(page, fonts, y)

    // Circuit rows
    for (let i = 0; i < boardCircuits.length; i++) {
      ensureSpace(ROW_HEIGHT + 4)
      if (needsNewPage(y, ROW_HEIGHT + 4)) {
        // Re-draw header on new page
        y = drawCircuitTableHeader(page, fonts, y)
      }
      y = drawCircuitRow(page, fonts, y, boardCircuits[i]!, i)
    }

    y -= SPACING.sectionGap
  }

  // ═════════════════════════════════════════════════════════════
  // FOOTER
  // ═════════════════════════════════════════════════════════════
  drawPageFooter(page, fonts.regular)

  return await pdfDoc.save()
}

// ── Browser helpers ─────────────────────────────────────────────

/**
 * Generate EIC PDF and return a blob URL for download.
 */
export async function generateEICBlobUrl(
  cert: EICCertificate,
): Promise<{ url: string; filename: string }> {
  const pdfBytes = await generateEICPdf(cert)
  const buffer = new ArrayBuffer(pdfBytes.byteLength)
  new Uint8Array(buffer).set(pdfBytes)
  const blob = new Blob([buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const addr = (cert.installationDetails?.installationAddress || '').split('\n')[0]?.trim().replace(/[^a-zA-Z0-9]/g, '_') || 'EIC'
  const filename = `EIC_${addr}_${cert.extentOfWork?.dateCompleted || 'draft'}.pdf`
  return { url, filename }
}
