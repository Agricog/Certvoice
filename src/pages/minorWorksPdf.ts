/**
 * CertVoice — Minor Works PDF Generator
 *
 * Client-side PDF generation using jsPDF.
 * Produces a single-page (or two-page) PDF matching
 * BS 7671 Model Form 3 layout.
 *
 * @module services/minorWorksPdf
 */

import { jsPDF } from 'jspdf';
import type { MinorWorksCertificate } from '../types/minorWorks';

// ── Layout constants ────────────────────────────────────────────
const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN_L = 12;
const MARGIN_R = 12;
const MARGIN_T = 12;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

// Colours
const DARK = '#1a1a2e';
const MID = '#555555';
const LIGHT = '#888888';
const ACCENT = '#d97706'; // amber-600
const LINE_COL = '#cccccc';
const HEADER_BG = '#f5f5f5';

// ── Helpers ─────────────────────────────────────────────────────

function drawHLine(doc: jsPDF, y: number, x1 = MARGIN_L, x2 = PAGE_W - MARGIN_R) {
  doc.setDrawColor(LINE_COL);
  doc.setLineWidth(0.2);
  doc.line(x1, y, x2, y);
}

function drawSectionHeader(doc: jsPDF, y: number, title: string): number {
  doc.setFillColor(HEADER_BG);
  doc.rect(MARGIN_L, y, CONTENT_W, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(DARK);
  doc.text(title, MARGIN_L + 2, y + 4);
  return y + 7;
}

function drawFieldRow(
  doc: jsPDF,
  y: number,
  fields: { label: string; value: string; width?: number }[]
): number {
  const totalExplicit = fields.reduce((sum, f) => sum + (f.width ?? 0), 0);
  const autoFields = fields.filter((f) => !f.width);
  const autoWidth = autoFields.length > 0
    ? (CONTENT_W - totalExplicit) / autoFields.length
    : 0;

  let x = MARGIN_L;
  for (const field of fields) {
    const w = field.width ?? autoWidth;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(LIGHT);
    doc.text(field.label, x + 1, y + 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(DARK);
    const val = field.value || '—';
    doc.text(val, x + 1, y + 7, { maxWidth: w - 2 });

    x += w;
  }

  drawHLine(doc, y + 9);
  return y + 10;
}

function drawTextBlock(doc: jsPDF, y: number, label: string, value: string, maxH = 16): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(LIGHT);
  doc.text(label, MARGIN_L + 1, y + 3);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(DARK);
  const lines = doc.splitTextToSize(value || '—', CONTENT_W - 4);
  const textH = Math.min(lines.length * 3.2, maxH);
  doc.text(lines.slice(0, Math.floor(maxH / 3.2)), MARGIN_L + 1, y + 7);

  drawHLine(doc, y + 7 + textH);
  return y + 8 + textH;
}

function earthingLabel(type: string): string {
  const map: Record<string, string> = {
    TN_C: 'TN-C',
    TN_S: 'TN-S',
    TN_C_S: 'TN-C-S',
    TT: 'TT',
    IT: 'IT',
  };
  return map[type] || type || '—';
}

// ── Main generator ──────────────────────────────────────────────

export function generateMinorWorksPdf(cert: MinorWorksCertificate): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN_T;

  // ═══════════════════════════════════════════════════════════════
  // TITLE
  // ═══════════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(ACCENT);
  doc.text('MINOR ELECTRICAL INSTALLATION WORKS CERTIFICATE', PAGE_W / 2, y + 4, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(MID);
  doc.text('(Requirements for Electrical Installations — IET Wiring Regulations BS 7671)', PAGE_W / 2, y + 9, { align: 'center' });

  y += 13;
  drawHLine(doc, y);
  y += 2;

  // ═══════════════════════════════════════════════════════════════
  // PART 1: DESCRIPTION OF MINOR WORKS
  // ═══════════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, y, 'PART 1: DESCRIPTION OF MINOR WORKS');

  y = drawFieldRow(doc, y, [
    { label: 'Client', value: cert.clientDetails.clientName },
    { label: 'Date of Completion', value: cert.description.dateOfCompletion, width: 40 },
  ]);

  y = drawFieldRow(doc, y, [
    { label: 'Installation Address', value: cert.clientDetails.clientAddress },
  ]);

  y = drawTextBlock(doc, y, 'Description of the minor works', cert.description.descriptionOfWork, 12);

  if (cert.description.commentsOnExisting) {
    y = drawTextBlock(doc, y, 'Comments on existing installation', cert.description.commentsOnExisting, 10);
  }

  // ═══════════════════════════════════════════════════════════════
  // PART 2: INSTALLATION DETAILS
  // ═══════════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, y, 'PART 2: INSTALLATION DETAILS');

  y = drawFieldRow(doc, y, [
    { label: 'Earthing System', value: earthingLabel(cert.installation.earthingType) },
    { label: 'Method of Fault Protection', value: cert.installation.methodOfFaultProtection },
  ]);

  y = drawFieldRow(doc, y, [
    { label: 'Existing Protective Device Type', value: cert.installation.existingProtectiveDevice.type },
    { label: 'Rating (A)', value: cert.installation.existingProtectiveDevice.rating, width: 30 },
  ]);

  // ═══════════════════════════════════════════════════════════════
  // PART 3: CIRCUIT DETAILS
  // ═══════════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, y, 'PART 3: CIRCUIT DETAILS');

  y = drawFieldRow(doc, y, [
    { label: 'Circuit Description', value: cert.circuit.circuitDescription },
    { label: 'DB Ref', value: cert.circuit.dbReference, width: 25 },
    { label: 'Circuit No.', value: cert.circuit.circuitDesignation, width: 25 },
  ]);

  y = drawFieldRow(doc, y, [
    { label: 'Protective Device BS', value: cert.circuit.protectiveDevice.bs },
    { label: 'Type', value: cert.circuit.protectiveDevice.type, width: 25 },
    { label: 'Rating (A)', value: cert.circuit.protectiveDevice.rating, width: 25 },
  ]);

  y = drawFieldRow(doc, y, [
    { label: 'Cable Type', value: cert.circuit.wiringSystem.cableType },
    { label: 'CSA (mm²)', value: cert.circuit.wiringSystem.csa, width: 30 },
    { label: 'Ref Method', value: cert.circuit.wiringSystem.referenceMethod, width: 30 },
  ]);

  // ═══════════════════════════════════════════════════════════════
  // PART 4: TEST RESULTS
  // ═══════════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, y, 'PART 4: TEST RESULTS');

  y = drawFieldRow(doc, y, [
    { label: 'R1+R2 (Ω)', value: cert.testResults.earthContinuity.r1PlusR2 },
    { label: 'R2 (Ω)', value: cert.testResults.earthContinuity.r2 },
    { label: 'Insulation L-E (MΩ)', value: cert.testResults.insulationResistance.liveToEarth },
    { label: 'Insulation L-N (MΩ)', value: cert.testResults.insulationResistance.liveToNeutral },
  ]);

  y = drawFieldRow(doc, y, [
    { label: 'Zs (Ω)', value: cert.testResults.earthFaultLoopImpedance.zs },
    { label: 'Polarity', value: cert.testResults.polarity ? cert.testResults.polarity.charAt(0).toUpperCase() + cert.testResults.polarity.slice(1) : '' },
    { label: 'Functional Testing', value: cert.testResults.functionalTesting ? cert.testResults.functionalTesting.charAt(0).toUpperCase() + cert.testResults.functionalTesting.slice(1) : '' },
  ]);

  if (cert.testResults.rcd.present) {
    y = drawFieldRow(doc, y, [
      { label: 'RCD Rated IΔn (mA)', value: cert.testResults.rcd.ratedResidualCurrent },
      { label: 'RCD Operating Time (ms)', value: cert.testResults.rcd.operatingTime },
    ]);
  }

  // ═══════════════════════════════════════════════════════════════
  // PART 5: DECLARATION
  // ═══════════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, y, 'PART 5: DECLARATION');

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6);
  doc.setTextColor(MID);
  doc.text(
    'I/We, being the person(s) responsible for the electrical installation work, hereby declare that the work detailed ' +
    'does not impair the safety of the existing installation and that it has been designed, constructed, inspected and ' +
    'tested in accordance with BS 7671 (IET Wiring Regulations).',
    MARGIN_L + 1,
    y + 3,
    { maxWidth: CONTENT_W - 2 }
  );
  y += 12;

  y = drawFieldRow(doc, y, [
    { label: 'Contractor / Company', value: cert.declaration.contractorName },
  ]);

  y = drawFieldRow(doc, y, [
    { label: 'Address', value: cert.declaration.contractorAddress },
  ]);

  y = drawFieldRow(doc, y, [
    { label: 'Telephone', value: cert.declaration.contractorTelephone },
    { label: 'Email', value: cert.declaration.contractorEmail },
  ]);

  y = drawFieldRow(doc, y, [
    { label: 'Installer Name', value: cert.declaration.installerName },
    { label: 'Date', value: cert.declaration.installerDate, width: 40 },
  ]);

  y = drawFieldRow(doc, y, [
    { label: 'Scheme Provider', value: cert.declaration.schemeProvider },
    { label: 'Membership No.', value: cert.declaration.schemeMembershipNumber, width: 50 },
  ]);

  // ═══════════════════════════════════════════════════════════════
  // PART 6: NEXT INSPECTION
  // ═══════════════════════════════════════════════════════════════
  if (y + 20 > PAGE_H - 20) {
    doc.addPage();
    y = MARGIN_T;
  }

  y = drawSectionHeader(doc, y, 'PART 6: NEXT INSPECTION');

  y = drawFieldRow(doc, y, [
    { label: 'Recommended Date', value: cert.nextInspection.recommendedDate },
    { label: 'Reason', value: cert.nextInspection.reason },
  ]);

  // ═══════════════════════════════════════════════════════════════
  // SCHEME NOTIFICATION REMINDER
  // ═══════════════════════════════════════════════════════════════
  if (cert.schemeNotification.partPRequired) {
    y += 3;
    doc.setFillColor('#FFF7ED');
    doc.roundedRect(MARGIN_L, y, CONTENT_W, 10, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(ACCENT);
    doc.text('PART P NOTIFICATION', MARGIN_L + 2, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(MID);
    const notifStatus = cert.schemeNotification.notificationSubmitted
      ? `Submitted ${cert.schemeNotification.notificationDate || ''} — Ref: ${cert.schemeNotification.schemeReference || 'pending'}`
      : 'Not yet submitted — notify via scheme provider portal';
    doc.text(notifStatus, MARGIN_L + 2, y + 8);
  }

  // ═══════════════════════════════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════════════════════════════
  const footerY = PAGE_H - 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(LIGHT);
  doc.text('Generated by CertVoice — certvoice.co.uk', MARGIN_L, footerY);
  doc.text(`Certificate ID: ${cert.id.substring(0, 8)}`, PAGE_W - MARGIN_R, footerY, { align: 'right' });

  // ── Return as Blob ────────────────────────────────────────────
  return doc.output('blob');
}
