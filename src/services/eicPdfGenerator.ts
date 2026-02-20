/**
 * CertVoice — EIC PDF Generator (Client-Side)
 *
 * Generates official BS 7671:2018+A2:2022 compliant Electrical Installation
 * Certificates using pdf-lib. Runs entirely in the browser — works offline.
 *
 * Pages:
 *   1. Sections A-C (client, installation, extent of work)
 *   2. Section D (design) + Section E (departures from BS 7671)
 *   3. Section F (three declarations + signatures) + Section G (Part P)
 *   4. Section H (existing installation) + Sections I-J (supply + particulars)
 *   5+. Schedule of inspections (dynamic, overflows)
 *   N+. Circuit test results schedule (dynamic, overflows)
 *
 * Signatures:
 *   Up to 5 possible: Designer, Constructor, Inspector, QS, plus duplicates
 *   if samePersonAllRoles is false. Fetches PNGs from R2 via worker.
 *
 * NOTE: pdf-lib StandardFonts (Helvetica) only support WinAnsi encoding.
 * All text must use ASCII / Latin-1 characters only. No Greek letters,
 * no tick/cross marks, no superscripts.
 *
 * @module services/eicPdfGenerator
 */

import { PDFDocument, StandardFonts, type PDFPage, type PDFFont } from 'pdf-lib'
import type { EICCertificate, InspectionItem } from '../types/eic'
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
  drawTableHeader,
  drawTableRow,
  drawPageFooter,
  wrapText,
  needsNewPage,
} from './pdfStyles'

// ============================================================
// SIGNATURE FETCHER
// ============================================================

const R2_BASE_URL = import.meta.env.VITE_R2_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? ''

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

    const res = await fetch(`${R2_BASE_URL}/api/download-url`, {
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
  regular: PDFFont
  bold: PDFFont
}

interface AllSignatures {
  designer: Uint8Array | null
  constructor: Uint8Array | null
  inspector: Uint8Array | null
  qs: Uint8Array | null
}

// ============================================================
// SAFE VALUE HELPERS
// ============================================================

/** Replace non-WinAnsi characters with ASCII equivalents */
function sanitize(text: string): string {
  return text
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/±/g, '+/-')
    .replace(/Ω/g, 'ohm')
    .replace(/°/g, 'deg')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'")
    .replace(/\u201C/g, '"')
    .replace(/\u201D/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00D7/g, 'x')
    .replace(/[^\x00-\xFF]/g, '?')
}

/** Safely convert any value to a display string */
function s(val: unknown): string {
  if (val == null || val === '') return '--'
  return sanitize(String(val))
}

/** Format ISO date string to UK locale */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '--'
  try {
    return new Date(iso).toLocaleDateString('en-GB')
  } catch {
    return iso
  }
}

// ============================================================
// PAGE HEADER
// ============================================================

function drawHeader(
  page: PDFPage,
  fonts: FontSet,
  reportNumber: string,
  pageNum: number,
): number {
  const y = PAGE.height - PAGE.marginTop

  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - SPACING.pageHeaderHeight,
    width: CONTENT_WIDTH,
    height: SPACING.pageHeaderHeight,
    color: COLOURS.headerBg,
  })

  // Accent bar at top of header
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y,
    width: CONTENT_WIDTH,
    height: 2,
    color: COLOURS.accent,
  })

  page.drawText('ELECTRICAL INSTALLATION CERTIFICATE', {
    x: PAGE.marginLeft + 10,
    y: y - 18,
    size: 11,
    font: fonts.bold,
    color: COLOURS.white,
  })

  page.drawText('In accordance with BS 7671:2018+A2:2022', {
    x: PAGE.marginLeft + 10,
    y: y - 30,
    size: FONT.small,
    font: fonts.regular,
    color: COLOURS.muted,
  })

  const reportText = `Certificate: ${reportNumber || '--'}`
  const rw = fonts.bold.widthOfTextAtSize(reportText, FONT.reportNumber)
  page.drawText(reportText, {
    x: PAGE.width - PAGE.marginRight - rw - 10,
    y: y - 18,
    size: FONT.reportNumber,
    font: fonts.bold,
    color: COLOURS.accent,
  })

  const pageText = `Page ${pageNum}`
  const pw = fonts.regular.widthOfTextAtSize(pageText, FONT.pageNumber)
  page.drawText(pageText, {
    x: PAGE.width - PAGE.marginRight - pw - 10,
    y: y - 30,
    size: FONT.pageNumber,
    font: fonts.regular,
    color: COLOURS.muted,
  })

  return y - SPACING.pageHeaderHeight - SPACING.sectionGap
}

// ============================================================
// PAGE 1: SECTIONS A-C (CLIENT, INSTALLATION, EXTENT)
// ============================================================

function drawClientExtentPage(
  pdfDoc: PDFDocument,
  cert: EICCertificate,
  fonts: FontSet,
): void {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let y = drawHeader(page, fonts, cert.reportNumber, 1)

  const client = cert.clientDetails
  const install = cert.installationDetails
  const extent = cert.extentOfWork

  // --- Section A: Client Details ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section A - Details of the Client')
  y = drawField(page, fonts.regular, fonts.bold, y, 'Client Name', s(client?.clientName))
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Client Address', s(client?.clientAddress))
  y -= SPACING.sectionGap

  // --- Section B: Installation Details ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section B - Details of the Installation')
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Installation Address', s(install?.installationAddress))
  y = drawField(page, fonts.regular, fonts.bold, y, 'Occupier', s(install?.occupier))

  const premisesMap: Record<string, string> = {
    DOMESTIC: 'Domestic', COMMERCIAL: 'Commercial', INDUSTRIAL: 'Industrial',
    OTHER: install?.otherDescription ?? 'Other',
  }
  y = drawField(page, fonts.regular, fonts.bold, y, 'Type of Premises', premisesMap[install?.premisesType ?? ''] ?? '--')
  y -= SPACING.sectionGap

  // --- Section C: Extent of Work ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section C - Extent and Description of the Installation Work')

  const workMap: Record<string, string> = {
    NEW_INSTALLATION: 'New installation',
    ADDITION: 'Addition to existing installation',
    ALTERATION: 'Alteration to existing installation',
    NEW_AND_ADDITION: 'New installation and addition',
    OTHER: extent?.otherDescription ?? 'Other',
  }
  y = drawField(page, fonts.regular, fonts.bold, y, 'Type of Work', workMap[extent?.workExtent ?? ''] ?? '--')
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Description of Work', s(extent?.descriptionOfWork))
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Date Commenced', value: formatDate(extent?.dateCommenced) },
    { label: 'Date Completed', value: formatDate(extent?.dateCompleted) },
  )

  drawPageFooter(page, fonts.regular)
}

// ============================================================
// PAGE 2: SECTION D (DESIGN) + SECTION E (DEPARTURES)
// ============================================================

function drawDesignDeparturesPage(
  pdfDoc: PDFDocument,
  cert: EICCertificate,
  fonts: FontSet,
): void {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let y = drawHeader(page, fonts, cert.reportNumber, 2)

  const design = cert.design
  const departures = cert.departures ?? []

  // --- Section D: Design ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section D - Design')

  const demandUnit = design?.maxDemandUnit === 'KVA' ? 'kVA' : 'A'
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Maximum Demand', value: design?.maxDemand != null ? `${design.maxDemand} ${demandUnit}` : '--' },
    { label: 'Number of Phases', value: design?.numberOfPhases != null ? `${design.numberOfPhases}` : '--' },
  )

  // Design confirmations
  const confirmations: [string, boolean | undefined][] = [
    ['OCPD characteristics appropriate', design?.ocpdCharacteristicsAppropriate],
    ['Circuits adequately sized', design?.circuitsAdequatelySized],
    ['Disconnection times achievable', design?.disconnectionTimesAchievable],
    ['SPD risk assessment carried out', design?.spdAssessmentDone],
  ]

  for (const [label, value] of confirmations) {
    const confirmed = value === true
    y = drawField(page, fonts.regular, fonts.bold, y, label, confirmed ? 'Yes' : 'No', {
      valueColour: confirmed ? COLOURS.pass : COLOURS.fail,
    })
  }

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'SPD Required', value: design?.spdRequired ? 'Yes' : 'No' },
    { label: 'SPD Fitted', value: design?.spdFitted ? 'Yes' : 'No' },
  )

  if (design?.energyEfficiencyDetails) {
    y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Energy Efficiency', s(design.energyEfficiencyDetails))
  }
  if (design?.designComments) {
    y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Design Comments', s(design.designComments))
  }
  y -= SPACING.sectionGap

  // --- Section E: Departures from BS 7671 ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section E - Departures from BS 7671')

  if (departures.length === 0) {
    y = drawField(page, fonts.regular, fonts.bold, y, 'Departures', 'None')
  } else {
    const depCols = [
      { label: 'No.', width: 28, align: 'center' as const },
      { label: 'Regulation', width: 70 },
      { label: 'Description', width: 180 },
      { label: 'Justification', width: 160 },
      { label: 'Agreed By', width: 77 },
    ]

    y = drawTableHeader(page, fonts.bold, y, depCols)

    for (let i = 0; i < departures.length; i++) {
      const dep = departures[i]
      if (!dep) continue

      if (needsNewPage(y, SPACING.tableRowHeight)) break

      y = drawTableRow(
        page, fonts.regular, y,
        depCols.map((c) => ({ width: c.width, align: c.align })),
        [
          String(dep.itemNumber),
          dep.regulationReference ?? '',
          (dep.description ?? '').substring(0, 50),
          (dep.justification ?? '').substring(0, 40),
          (dep.agreedBy ?? '').substring(0, 16),
        ],
        { isAlt: i % 2 === 1 },
      )
    }
  }

  drawPageFooter(page, fonts.regular)
}

// ============================================================
// HELPER: DRAW A SINGLE DECLARATION BLOCK
// ============================================================

async function drawDeclarationBlock(
  pdfDoc: PDFDocument,
  page: PDFPage,
  fonts: FontSet,
  y: number,
  role: string,
  decl: {
    name: string
    companyName: string
    companyAddress: string
    position: string
    registrationNumber: string
    dateSigned?: string
    signatureKey: string | null
  },
  sigImage: Uint8Array | null,
): Promise<number> {
  // Role sub-header bar
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - 12,
    width: CONTENT_WIDTH,
    height: 14,
    color: COLOURS.rowAlt,
  })
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - 12,
    width: 2,
    height: 14,
    color: COLOURS.accent,
  })
  page.drawText(role.toUpperCase(), {
    x: PAGE.marginLeft + 8,
    y: y - 9,
    size: FONT.label,
    font: fonts.bold,
    color: COLOURS.accent,
  })
  y -= 20

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Name', value: s(decl.name) },
    { label: 'Position', value: s(decl.position) },
  )
  y = drawField(page, fonts.regular, fonts.bold, y, 'Company', s(decl.companyName))
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Registration No', value: s(decl.registrationNumber) },
    { label: 'Date Signed', value: formatDate(decl.dateSigned) },
  )

  // Signature
  if (sigImage) {
    page.drawText('Signature', { x: PAGE.marginLeft, y, size: FONT.label, font: fonts.regular, color: COLOURS.label })
    try {
      const img = await pdfDoc.embedPng(sigImage)
      const h = 24
      const w = Math.min(h * (img.width / img.height), 130)
      page.drawImage(img, { x: PAGE.marginLeft + 130, y: y - h + 4, width: w, height: h })
    } catch {
      page.drawText('[Signature on file]', { x: PAGE.marginLeft + 130, y, size: FONT.value, font: fonts.bold, color: COLOURS.text })
    }
    y -= 28
  } else {
    y = drawField(page, fonts.regular, fonts.bold, y, 'Signature', decl.signatureKey ? '[Signature on file]' : '______________________')
  }

  return y
}

// ============================================================
// PAGE 3+: SECTION F (DECLARATIONS) + SECTION G (PART P)
// ============================================================

async function drawDeclarationsPartPPages(
  pdfDoc: PDFDocument,
  cert: EICCertificate,
  fonts: FontSet,
  sigs: AllSignatures,
): Promise<number> {
  let page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let pageNum = 3
  let y = drawHeader(page, fonts, cert.reportNumber, pageNum)

  const decls = cert.declarations

  // --- Section F: Declaration ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section F - Declaration')

  const declText = 'I/We, the undersigned, being the person(s) responsible for the design, construction, inspection and testing of the electrical installation (as indicated by my/our signatures below), particulars of which are described in this Certificate, having exercised reasonable skill and care when carrying out the design, construction, inspection and testing, hereby declare that the said work for which I/we have been responsible is to the best of my/our knowledge and belief in accordance with BS 7671:2018+A2:2022, except for the departures, if any, detailed in Section E.'
  const declLines = wrapText(declText, fonts.regular, FONT.label, CONTENT_WIDTH)
  for (const line of declLines) {
    page.drawText(line, { x: PAGE.marginLeft, y, size: FONT.label, font: fonts.regular, color: COLOURS.text })
    y -= 10
  }
  y -= 6

  // Designer declaration
  y = await drawDeclarationBlock(pdfDoc, page, fonts, y, 'Designer', {
    name: decls?.designer?.name ?? '',
    companyName: decls?.designer?.companyName ?? '',
    companyAddress: decls?.designer?.companyAddress ?? '',
    position: decls?.designer?.position ?? '',
    registrationNumber: decls?.designer?.registrationNumber ?? '',
    dateSigned: decls?.designer?.dateSigned ?? '',
    signatureKey: decls?.designer?.signatureKey ?? null,
  }, sigs.designer)

  drawHorizontalRule(page, y + 4, COLOURS.borderLight)
  y -= 4

  // Constructor declaration
  y = await drawDeclarationBlock(pdfDoc, page, fonts, y, 'Constructor', {
    name: decls?.constructor?.name ?? '',
    companyName: decls?.constructor?.companyName ?? '',
    companyAddress: decls?.constructor?.companyAddress ?? '',
    position: decls?.constructor?.position ?? '',
    registrationNumber: decls?.constructor?.registrationNumber ?? '',
    dateSigned: decls?.constructor?.dateSigned ?? '',
    signatureKey: decls?.constructor?.signatureKey ?? null,
  }, sigs.constructor)

  drawHorizontalRule(page, y + 4, COLOURS.borderLight)
  y -= 4

  // Check if inspector fits on same page — needs ~140pt
  if (needsNewPage(y, 140)) {
    drawPageFooter(page, fonts.regular)
    page = pdfDoc.addPage([PAGE.width, PAGE.height])
    pageNum++
    y = drawHeader(page, fonts, cert.reportNumber, pageNum)
    y = drawSectionHeader(page, fonts.bold, y, 'Section F - Declaration (continued)')
  }

  // Inspector declaration
  y = await drawDeclarationBlock(pdfDoc, page, fonts, y, 'Inspector', {
    name: decls?.inspector?.name ?? '',
    companyName: decls?.inspector?.companyName ?? '',
    companyAddress: decls?.inspector?.companyAddress ?? '',
    position: decls?.inspector?.position ?? '',
    registrationNumber: decls?.inspector?.registrationNumber ?? '',
    dateSigned: decls?.inspector?.dateSigned ?? '',
    signatureKey: decls?.inspector?.signatureKey ?? null,
  }, sigs.inspector)

  // QS details (if present on inspector declaration)
  if (decls?.inspector?.qsName) {
    drawHorizontalRule(page, y + 4, COLOURS.borderLight)
    y -= 4
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'QS Name', value: s(decls.inspector.qsName) },
      { label: 'QS Date', value: formatDate(decls.inspector.qsDateSigned) },
    )

    if (sigs.qs) {
      page.drawText('QS Signature', { x: PAGE.marginLeft, y, size: FONT.label, font: fonts.regular, color: COLOURS.label })
      try {
        const img = await pdfDoc.embedPng(sigs.qs)
        const h = 24
        const w = Math.min(h * (img.width / img.height), 130)
        page.drawImage(img, { x: PAGE.marginLeft + 130, y: y - h + 4, width: w, height: h })
      } catch {
        page.drawText('[Signature on file]', { x: PAGE.marginLeft + 130, y, size: FONT.value, font: fonts.bold, color: COLOURS.text })
      }
      y -= 28
    } else if (decls.inspector.qsSignatureKey) {
      y = drawField(page, fonts.regular, fonts.bold, y, 'QS Signature', '[Signature on file]')
    }
  }

  y -= SPACING.sectionGap

  // --- Section G: Part P Building Regulations Notification ---
  if (needsNewPage(y, 80)) {
    drawPageFooter(page, fonts.regular)
    page = pdfDoc.addPage([PAGE.width, PAGE.height])
    pageNum++
    y = drawHeader(page, fonts, cert.reportNumber, pageNum)
  }

  y = drawSectionHeader(page, fonts.bold, y, 'Section G - Part P Building Regulations Notification')

  const partP = cert.partPNotification
  y = drawField(page, fonts.regular, fonts.bold, y, 'Notifiable Work', partP?.isNotifiable ? 'Yes' : 'No')

  if (partP?.isNotifiable) {
    y = drawField(page, fonts.regular, fonts.bold, y, 'Notification Submitted', partP.notificationSubmitted ? 'Yes' : 'No', {
      valueColour: partP.notificationSubmitted ? COLOURS.pass : COLOURS.fail,
    })
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Scheme Body', value: s(partP.schemeBody) },
      { label: 'Reference No', value: s(partP.notificationReference) },
    )
    y = drawField(page, fonts.regular, fonts.bold, y, 'Date Submitted', formatDate(partP.dateSubmitted))
    if (partP.buildingControlBody) {
      y = drawField(page, fonts.regular, fonts.bold, y, 'Building Control Body', s(partP.buildingControlBody))
    }
  } else if (partP?.notes) {
    y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Notes', s(partP.notes))
  }

  drawPageFooter(page, fonts.regular)
  return pageNum + 1
}

// ============================================================
// PAGE: SECTION H (EXISTING) + SECTIONS I-J (SUPPLY)
// ============================================================

function drawExistingSupplyPage(
  pdfDoc: PDFDocument,
  cert: EICCertificate,
  fonts: FontSet,
  pageNum: number,
): number {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let y = drawHeader(page, fonts, cert.reportNumber, pageNum)

  // --- Section H: Comments on Existing Installation ---
  const existing = cert.existingInstallation

  y = drawSectionHeader(page, fonts.bold, y, 'Section H - Comments on Existing Installation')
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'General Condition', s(existing?.generalCondition))
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Defects Observed', s(existing?.defectsObserved))
  y = drawWrappedField(page, fonts.regular, fonts.bold, y, 'Recommendations', s(existing?.recommendations))
  y -= SPACING.sectionGap

  // --- Section I: Supply Characteristics ---
  const supply = cert.supplyCharacteristics

  y = drawSectionHeader(page, fonts.bold, y, 'Section I - Supply Characteristics and Earthing Arrangements')

  const earthingMap: Record<string, string> = {
    TN_C: 'TN-C', TN_S: 'TN-S', TN_C_S: 'TN-C-S', TT: 'TT', IT: 'IT',
  }

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Earthing System', value: earthingMap[supply?.earthingType ?? ''] ?? '--' },
    { label: 'Supply Type', value: s(supply?.supplyType) },
  )

  const configMap: Record<string, string> = {
    '1PH_2WIRE': '1-phase 2-wire', '2PH_3WIRE': '2-phase 3-wire',
    '3PH_3WIRE': '3-phase 3-wire', '3PH_4WIRE': '3-phase 4-wire',
  }
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Conductor Config', value: configMap[supply?.conductorConfig ?? ''] ?? '--' },
    { label: 'Nominal Voltage', value: supply?.nominalVoltage != null ? `${supply.nominalVoltage}V` : '--' },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Nominal Frequency', value: supply?.nominalFrequency != null ? `${supply.nominalFrequency}Hz` : '--' },
    { label: 'Prospective Fault (Ipf)', value: supply?.ipf != null ? `${supply.ipf} kA` : '--' },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'External Ze', value: supply?.ze != null ? `${supply.ze} ohm` : '--' },
    { label: 'Polarity Confirmed', value: supply?.supplyPolarityConfirmed ? 'Yes' : 'No' },
  )
  y = drawField(page, fonts.regular, fonts.bold, y, 'Other Sources', supply?.otherSourcesPresent ? `Yes - ${supply.otherSourcesDescription ?? ''}` : 'No')
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Supply Device BS(EN)', value: s(supply?.supplyDeviceBsEn) },
    { label: 'Supply Device Type', value: s(supply?.supplyDeviceType) },
  )
  y = drawField(page, fonts.regular, fonts.bold, y, 'Supply Device Rating', supply?.supplyDeviceRating != null ? `${supply.supplyDeviceRating}A` : '--')
  y -= SPACING.sectionGap

  // --- Section J: Installation Particulars ---
  const install = cert.installationParticulars

  y = drawSectionHeader(page, fonts.bold, y, 'Section J - Particulars of the Installation at the Origin')

  y = drawField(page, fonts.regular, fonts.bold, y, 'Means of Earthing',
    install?.distributorFacility ? 'Distributor facility' : install?.installationElectrode ? 'Installation electrode' : '--')

  if (install?.installationElectrode) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Electrode Type', value: s(install.electrodeType) },
      { label: 'Electrode Location', value: s(install.electrodeLocation) },
    )
    y = drawField(page, fonts.regular, fonts.bold, y, 'Electrode Resistance', install.electrodeResistance != null ? `${install.electrodeResistance} ohm` : '--')
  }

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Main Switch Location', value: s(install?.mainSwitchLocation) },
    { label: 'Main Switch BS(EN)', value: s(install?.mainSwitchBsEn) },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Poles', value: install?.mainSwitchPoles != null ? `${install.mainSwitchPoles}P` : '--' },
    { label: 'Current Rating', value: install?.mainSwitchCurrentRating != null ? `${install.mainSwitchCurrentRating}A` : '--' },
  )

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Earthing Conductor', value: `${install?.earthingConductorMaterial ?? 'COPPER'} ${install?.earthingConductorCsa != null ? `${install.earthingConductorCsa}mm2` : '--'} ${install?.earthingConductorVerified ? 'OK' : ''}` },
    { label: 'Bonding Conductor', value: `${install?.bondingConductorMaterial ?? 'COPPER'} ${install?.bondingConductorCsa != null ? `${install.bondingConductorCsa}mm2` : '--'} ${install?.bondingConductorVerified ? 'OK' : ''}` },
  )

  const bondItems = [
    ['Water', install?.bondingWater],
    ['Gas', install?.bondingGas],
    ['Oil', install?.bondingOil],
    ['Steel', install?.bondingSteel],
    ['Lightning', install?.bondingLightning],
    ['Other', install?.bondingOther],
  ] as const

  const bondStr = bondItems
    .filter(([, v]) => v && v !== 'NA')
    .map(([k, v]) => `${k}: ${v === 'SATISFACTORY' ? 'OK' : 'X'}`)
    .join('  |  ')

  if (bondStr) {
    y = drawField(page, fonts.regular, fonts.bold, y, 'Bonding', bondStr)
  }

  drawPageFooter(page, fonts.regular)
  return pageNum + 1
}

// ============================================================
// DYNAMIC PAGES: INSPECTION SCHEDULE
// ============================================================

function drawInspectionPages(
  pdfDoc: PDFDocument,
  cert: EICCertificate,
  fonts: FontSet,
  startPage: number,
): number {
  const items = (cert.inspectionSchedule ?? []) as InspectionItem[]
  if (items.length === 0) return startPage

  let page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let pageNum = startPage
  let y = drawHeader(page, fonts, cert.reportNumber, pageNum)

  y = drawSectionHeader(page, fonts.bold, y, 'Schedule of Inspections')

  let currentSection = -1

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    if (needsNewPage(y, SPACING.fieldRowHeight * 2)) {
      drawPageFooter(page, fonts.regular)
      page = pdfDoc.addPage([PAGE.width, PAGE.height])
      pageNum++
      y = drawHeader(page, fonts, cert.reportNumber, pageNum)
      y = drawSectionHeader(page, fonts.bold, y, 'Schedule of Inspections (continued)')
    }

    if (item.section !== currentSection) {
      currentSection = item.section
      y -= 4
      page.drawText(sanitize(item.sectionTitle ?? `Section ${item.section}`), {
        x: PAGE.marginLeft,
        y,
        size: FONT.label,
        font: fonts.bold,
        color: COLOURS.accent,
      })
      y -= SPACING.fieldRowHeight
    }

    page.drawText(item.itemRef ?? '', {
      x: PAGE.marginLeft,
      y,
      size: FONT.tableBody,
      font: fonts.regular,
      color: COLOURS.muted,
    })

    page.drawText(sanitize((item.description ?? '').substring(0, 70)), {
      x: PAGE.marginLeft + 40,
      y,
      size: FONT.tableBody,
      font: fonts.regular,
      color: COLOURS.text,
    })

    const outcome = item.outcome ?? '--'
    const outcomeColour =
      outcome === 'PASS' ? COLOURS.pass
        : outcome === 'C1' ? COLOURS.fail
          : outcome === 'C2' ? COLOURS.c2
            : COLOURS.muted

    const outcomeText = outcome === 'PASS' ? 'OK' : outcome
    const ow = fonts.bold.widthOfTextAtSize(outcomeText, FONT.tableBody)
    page.drawText(outcomeText, {
      x: PAGE.width - PAGE.marginRight - ow - 4,
      y,
      size: FONT.tableBody,
      font: fonts.bold,
      color: outcomeColour,
    })

    y -= SPACING.fieldRowHeight
  }

  drawPageFooter(page, fonts.regular)
  return pageNum + 1
}

// ============================================================
// DYNAMIC PAGES: CIRCUIT SCHEDULE
// ============================================================

function drawCircuitPages(
  pdfDoc: PDFDocument,
  cert: EICCertificate,
  fonts: FontSet,
  startPage: number,
): number {
  const circuits = cert.circuits ?? []
  if (circuits.length === 0) return startPage

  let page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let pageNum = startPage
  let y = drawHeader(page, fonts, cert.reportNumber, pageNum)

  y = drawSectionHeader(page, fonts.bold, y, 'Schedule of Circuit Details and Test Results')

  // Test instruments info
  const ti = cert.testInstruments
  if (ti?.multifunctionInstrument) {
    page.drawText(`Instruments: ${sanitize(ti.multifunctionInstrument)}`, {
      x: PAGE.marginLeft,
      y,
      size: FONT.small,
      font: fonts.regular,
      color: COLOURS.muted,
    })
    y -= SPACING.fieldRowHeight
  }

  const row1Cols = [
    { label: 'Cct', width: 28 },
    { label: 'Description', width: 90 },
    { label: 'Type', width: 24, align: 'center' as const },
    { label: 'Ref', width: 22, align: 'center' as const },
    { label: 'Pts', width: 24, align: 'center' as const },
    { label: 'Live', width: 28, align: 'center' as const },
    { label: 'CPC', width: 28, align: 'center' as const },
    { label: 'OCPD', width: 32, align: 'center' as const },
    { label: 'Rating', width: 34, align: 'center' as const },
    { label: 'RCD', width: 28, align: 'center' as const },
    { label: 'Idn', width: 28, align: 'center' as const },
  ]

  const row2Cols = [
    { label: 'r1', width: 28, align: 'center' as const },
    { label: 'rn', width: 28, align: 'center' as const },
    { label: 'r2', width: 28, align: 'center' as const },
    { label: 'R1+R2', width: 36, align: 'center' as const },
    { label: 'IR V', width: 30, align: 'center' as const },
    { label: 'IR L-L', width: 36, align: 'center' as const },
    { label: 'IR L-E', width: 36, align: 'center' as const },
    { label: 'Zs', width: 34, align: 'center' as const },
    { label: 'Pol', width: 26, align: 'center' as const },
    { label: 'RCD ms', width: 38, align: 'center' as const },
    { label: 'Rmks', width: 46 },
  ]

  const boards = cert.distributionBoards ?? []

  for (const board of boards) {
    const boardCircuits = circuits.filter((c) => c.dbId === board.dbReference)
    if (boardCircuits.length === 0) continue

    if (needsNewPage(y, SPACING.tableHeaderHeight * 3 + SPACING.tableRowHeight * 2)) {
      drawPageFooter(page, fonts.regular)
      page = pdfDoc.addPage([PAGE.width, PAGE.height])
      pageNum++
      y = drawHeader(page, fonts, cert.reportNumber, pageNum)
    }

    // DB header bar
    y -= 4
    page.drawRectangle({
      x: PAGE.marginLeft,
      y: y - 14,
      width: CONTENT_WIDTH,
      height: 18,
      color: COLOURS.headerBg,
    })
    page.drawRectangle({
      x: PAGE.marginLeft,
      y: y - 14,
      width: 3,
      height: 18,
      color: COLOURS.accent,
    })
    page.drawText(`DB: ${board.dbReference ?? '--'} - ${board.dbLocation ?? ''}  |  Zs at DB: ${board.zsAtDb ?? '--'} ohm  |  Ipf: ${board.ipfAtDb ?? '--'} kA`, {
      x: PAGE.marginLeft + 8,
      y: y - 10,
      size: FONT.tableBody,
      font: fonts.bold,
      color: COLOURS.white,
    })
    y -= 24

    y = drawTableHeader(page, fonts.bold, y, row1Cols)
    y = drawTableHeader(page, fonts.bold, y, row2Cols)

    for (let ci = 0; ci < boardCircuits.length; ci++) {
      const c = boardCircuits[ci]
      if (!c) continue

      if (needsNewPage(y, SPACING.tableRowHeight * 2 + 4)) {
        drawPageFooter(page, fonts.regular)
        page = pdfDoc.addPage([PAGE.width, PAGE.height])
        pageNum++
        y = drawHeader(page, fonts, cert.reportNumber, pageNum)
        y = drawSectionHeader(page, fonts.bold, y, `Circuit Schedule (continued) - ${board.dbReference}`)
        y = drawTableHeader(page, fonts.bold, y, row1Cols)
        y = drawTableHeader(page, fonts.bold, y, row2Cols)
      }

      y = drawTableRow(
        page, fonts.regular, y,
        row1Cols.map((col) => ({ width: col.width, align: col.align })),
        [
          s(c.circuitNumber),
          (c.circuitDescription ?? '').substring(0, 18),
          c.wiringType ?? '--',
          c.referenceMethod ?? '--',
          s(c.numberOfPoints),
          s(c.liveConductorCsa),
          s(c.cpcCsa),
          `${c.ocpdType ?? ''}${c.ocpdRating ?? ''}` || '--',
          c.ocpdBsEn ? c.ocpdBsEn.substring(0, 6) : '--',
          c.rcdType ?? '--',
          s(c.rcdRating),
        ],
        { isAlt: ci % 2 === 1 },
      )

      const zsExceeded = c.zs != null && c.maxPermittedZs != null && c.zs > c.maxPermittedZs

      y = drawTableRow(
        page, fonts.regular, y,
        row2Cols.map((col) => ({ width: col.width, align: col.align })),
        [
          s(c.r1),
          s(c.rn),
          s(c.r2),
          s(c.r1r2),
          s(c.irTestVoltage),
          s(c.irLiveLive),
          s(c.irLiveEarth),
          s(c.zs),
          c.polarity === 'TICK' ? 'OK' : c.polarity === 'CROSS' ? 'X' : '--',
          s(c.rcdDisconnectionTime),
          (c.remarks ?? '').substring(0, 12),
        ],
        { isAlt: ci % 2 === 1, textColour: zsExceeded ? COLOURS.fail : undefined },
      )
    }
  }

  drawPageFooter(page, fonts.regular)
  return pageNum + 1
}

// ============================================================
// MAIN GENERATOR
// ============================================================

/**
 * Generate a complete EIC PDF from certificate data.
 * Returns raw bytes — use generateEICBlobUrl() for browser download.
 */
export async function generateEICPdf(cert: EICCertificate): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fonts: FontSet = { regular, bold }

  pdfDoc.setTitle(`EIC ${cert.reportNumber ?? ''}`)
  pdfDoc.setAuthor(cert.declarations?.inspector?.name || 'CertVoice')
  pdfDoc.setSubject('Electrical Installation Certificate')
  pdfDoc.setCreator('CertVoice - certvoice.co.uk')
  pdfDoc.setCreationDate(new Date())

  // Page 1: Sections A-C
  drawClientExtentPage(pdfDoc, cert, fonts)

  // Page 2: Sections D-E
  drawDesignDeparturesPage(pdfDoc, cert, fonts)

  // Fetch all signatures in parallel (graceful fallback if offline)
  const decls = cert.declarations
  const [designerSig, constructorSig, inspectorSig, qsSig] = await Promise.all([
    decls?.designer?.signatureKey ? fetchSignaturePng(decls.designer.signatureKey) : Promise.resolve(null),
    decls?.constructor?.signatureKey ? fetchSignaturePng(decls.constructor.signatureKey) : Promise.resolve(null),
    decls?.inspector?.signatureKey ? fetchSignaturePng(decls.inspector.signatureKey) : Promise.resolve(null),
    decls?.inspector?.qsSignatureKey ? fetchSignaturePng(decls.inspector.qsSignatureKey) : Promise.resolve(null),
  ])

  // Page 3+: Section F (declarations) + Section G (Part P)
  const afterDecls = await drawDeclarationsPartPPages(pdfDoc, cert, fonts, {
    designer: designerSig,
    constructor: constructorSig,
    inspector: inspectorSig,
    qs: qsSig,
  })

  // Next page: Section H + Sections I-J
  let nextPage = drawExistingSupplyPage(pdfDoc, cert, fonts, afterDecls)

  // Dynamic pages: Inspection schedule
  nextPage = drawInspectionPages(pdfDoc, cert, fonts, nextPage)

  // Dynamic pages: Circuit schedule
  drawCircuitPages(pdfDoc, cert, fonts, nextPage)

  const pdfBytes = await pdfDoc.save()
  return pdfBytes
}

// ============================================================
// BROWSER DOWNLOAD
// ============================================================

/**
 * Generate EIC PDF and return a blob URL for download.
 * Caller is responsible for showing a download link and revoking the URL.
 */
export async function generateEICBlobUrl(cert: EICCertificate): Promise<{ url: string; filename: string }> {
  const pdfBytes = await generateEICPdf(cert)
  const buffer = new ArrayBuffer(pdfBytes.byteLength)
  new Uint8Array(buffer).set(pdfBytes)
  const blob = new Blob([buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const filename = `EIC-${cert.reportNumber || cert.id}.pdf`
  return { url, filename }
}
