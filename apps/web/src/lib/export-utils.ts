'use client';

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';

export interface ExportColumn<T = any> {
  key: string;
  label: string;
  /** Optional value accessor / formatter (defaults to row[key]). */
  value?: (row: T) => string | number | null | undefined;
}

const cellText = <T,>(row: T, col: ExportColumn<T>): string => {
  const raw = col.value ? col.value(row) : (row as any)[col.key];
  if (raw === null || raw === undefined) return '';
  return String(raw);
};

/** Export an array of rows to a real .xlsx workbook (SheetJS). */
export function exportToExcel<T>(filename: string, rows: T[], columns: ExportColumn<T>[]) {
  const aoa = [
    columns.map((c) => c.label),
    ...rows.map((r) => columns.map((c) => cellText(r, c))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Auto width based on the longest cell per column.
  ws['!cols'] = columns.map((c, i) => ({
    wch: Math.min(50, Math.max(c.label.length, ...rows.map((r) => cellText(r, columns[i]).length), 8)) + 2,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

const PAGE = { w: 297, h: 210, margin: 12 }; // A4 landscape (mm)

/** Brand header drawn at the top of every PDF page. */
function pdfHeader(doc: jsPDF, title: string, subtitle?: string) {
  doc.setFillColor(79, 70, 229); // indigo
  doc.rect(0, 0, PAGE.w, 16, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Industry360°', PAGE.margin, 10.5);
  doc.setFontSize(11);
  doc.text(title, PAGE.w / 2, 10.5, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(new Date().toLocaleString(), PAGE.w - PAGE.margin, 10.5, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.text(subtitle, PAGE.margin, 22);
    doc.setTextColor(0, 0, 0);
  }
}

/** Export rows to a professional, paginated landscape PDF table. */
export function exportToPDF<T>(title: string, rows: T[], columns: ExportColumn<T>[], subtitle?: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const usable = PAGE.w - PAGE.margin * 2;
  const colW = usable / columns.length;
  let y = subtitle ? 28 : 22;

  const drawHeadRow = () => {
    doc.setFillColor(238, 240, 247);
    doc.rect(PAGE.margin, y, usable, 8, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    columns.forEach((c, i) => doc.text(c.label, PAGE.margin + i * colW + 1.5, y + 5.4, { maxWidth: colW - 3 }));
    y += 8;
    doc.setFont('helvetica', 'normal');
  };

  pdfHeader(doc, title, subtitle);
  drawHeadRow();

  doc.setFontSize(7.5);
  rows.forEach((r, idx) => {
    if (y > PAGE.h - 14) {
      doc.addPage();
      y = 22;
      pdfHeader(doc, title);
      drawHeadRow();
      doc.setFontSize(7.5);
    }
    if (idx % 2 === 1) {
      doc.setFillColor(248, 249, 252);
      doc.rect(PAGE.margin, y, usable, 7, 'F');
    }
    columns.forEach((c, i) => {
      const txt = cellText(r, c);
      doc.text(txt.length > 60 ? txt.slice(0, 57) + '…' : txt, PAGE.margin + i * colW + 1.5, y + 4.8, { maxWidth: colW - 3 });
    });
    y += 7;
  });

  // Footer row count
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`${rows.length} record(s)`, PAGE.margin, PAGE.h - 6);
  doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
}

export interface PdfSection {
  heading: string;
  fields: Array<{ label: string; value: string }>;
}

/** Export a single record (e.g. a work order / NCR) to a portrait PDF document. */
export function exportRecordToPDF(title: string, subtitle: string, sections: PdfSection[]) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, margin = 14;
  // Header band
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, W, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Industry360°', margin, 11);
  doc.setFontSize(11);
  doc.text(title, W - margin, 8, { align: 'right' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(subtitle, W - margin, 13.5, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  let y = 26;
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
  doc.setTextColor(0, 0, 0);
  y += 6;

  sections.forEach((sec) => {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.setFillColor(238, 240, 247);
    doc.rect(margin, y, W - margin * 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(sec.heading, margin + 2, y + 4.9);
    y += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    sec.fields.forEach((f) => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.setTextColor(110, 110, 110);
      doc.text(f.label, margin + 2, y, { maxWidth: 55 });
      doc.setTextColor(0, 0, 0);
      const lines = doc.splitTextToSize(f.value || '—', W - margin * 2 - 62);
      doc.text(lines, margin + 60, y);
      y += Math.max(6, lines.length * 5);
    });
    y += 3;
  });

  doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
}
