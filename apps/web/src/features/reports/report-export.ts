'use client';

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import type { ExportColumn } from '@/lib/export-utils';
import type { ReportModel } from './report-definitions';

type Row = Record<string, unknown>;

const cellText = (row: Row, col: ExportColumn<Row>): string => {
  const raw = col.value ? col.value(row) : (row as any)[col.key];
  return raw == null ? '' : String(raw);
};

// ---------------------------------------------------------------------------
// PDF export with embedded chart images (jsPDF + html2canvas)
// ---------------------------------------------------------------------------

const A4 = { w: 210, h: 297, margin: 14 }; // A4 portrait (mm)

interface PdfHeaderOpts {
  title: string;
  subtitle?: string;
  generatedLabel: string;
}

function drawHeader(doc: jsPDF, opts: PdfHeaderOpts) {
  doc.setFillColor(79, 70, 229); // indigo
  doc.rect(0, 0, A4.w, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Industry360°', A4.margin, 11);
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(opts.title, A4.w - A4.margin * 2 - 50);
  doc.text(String(lines[0] ?? opts.title), A4.w - A4.margin, 8, { align: 'right' });
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text(opts.generatedLabel, A4.w - A4.margin, 13.5, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}

/**
 * Build a professional report PDF: branded header, KPI summary block,
 * captured chart images, then the detail table.
 */
export async function exportReportPDF(opts: {
  title: string;
  subtitle?: string;
  model: ReportModel;
  rows: Row[];
  /** Live chart DOM nodes to capture (in render order). */
  chartNodes: HTMLElement[];
  labels: {
    generated: string; // e.g. "Generated {{when}}"
    summary: string;
    details: string;
    records: string; // e.g. "{{count}} record(s)"
  };
}): Promise<void> {
  const { title, subtitle, model, rows, chartNodes, labels } = opts;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const usable = A4.w - A4.margin * 2;
  const generatedLabel = labels.generated.replace('{{when}}', new Date().toLocaleString());

  let y = 24;
  const ensureSpace = (needed: number) => {
    if (y + needed > A4.h - 12) {
      doc.addPage();
      drawHeader(doc, { title, subtitle, generatedLabel });
      y = 24;
    }
  };

  drawHeader(doc, { title, subtitle, generatedLabel });

  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.text(subtitle, A4.margin, y);
    doc.setTextColor(0, 0, 0);
    y += 7;
  }

  // --- KPI summary block (row of boxes, wrapping) ---
  if (model.kpis.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(labels.summary, A4.margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');

    const perRow = 3;
    const gap = 4;
    const boxW = (usable - gap * (perRow - 1)) / perRow;
    const boxH = 16;
    model.kpis.forEach((k, i) => {
      const col = i % perRow;
      if (col === 0) ensureSpace(boxH + 2);
      const x = A4.margin + col * (boxW + gap);
      doc.setFillColor(244, 245, 250);
      doc.setDrawColor(225, 227, 235);
      doc.roundedRect(x, y, boxW, boxH, 1.5, 1.5, 'FD');
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(7);
      doc.text(doc.splitTextToSize(k.label, boxW - 4), x + 2.5, y + 5);
      doc.setTextColor(30, 30, 30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(doc.splitTextToSize(k.value, boxW - 4), x + 2.5, y + 12);
      doc.setFont('helvetica', 'normal');
      if (col === perRow - 1 || i === model.kpis.length - 1) y += boxH + gap;
    });
    doc.setTextColor(0, 0, 0);
    y += 2;
  }

  // --- Chart images ---
  for (const node of chartNodes) {
    if (!node) continue;
    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(node, { backgroundColor: '#0b0e16', scale: 2, logging: false });
    } catch {
      continue;
    }
    const imgData = canvas.toDataURL('image/png');
    const imgW = usable;
    const imgH = (canvas.height / canvas.width) * imgW;
    ensureSpace(imgH + 4);
    doc.addImage(imgData, 'PNG', A4.margin, y, imgW, imgH, undefined, 'FAST');
    y += imgH + 5;
  }

  // --- Detail table ---
  const columns = model.columns;
  if (rows.length && columns.length) {
    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(labels.details, A4.margin, y);
    y += 4;

    const colW = usable / columns.length;
    const drawHeadRow = () => {
      doc.setFillColor(238, 240, 247);
      doc.rect(A4.margin, y, usable, 7, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      columns.forEach((c, i) =>
        doc.text(c.label, A4.margin + i * colW + 1.5, y + 4.8, { maxWidth: colW - 3 }),
      );
      y += 7;
      doc.setFont('helvetica', 'normal');
    };
    drawHeadRow();

    doc.setFontSize(7);
    rows.forEach((r, idx) => {
      if (y > A4.h - 14) {
        doc.addPage();
        drawHeader(doc, { title, subtitle, generatedLabel });
        y = 24;
        drawHeadRow();
        doc.setFontSize(7);
      }
      if (idx % 2 === 1) {
        doc.setFillColor(248, 249, 252);
        doc.rect(A4.margin, y, usable, 6, 'F');
      }
      columns.forEach((c, i) => {
        const txt = cellText(r, c);
        doc.text(txt.length > 40 ? txt.slice(0, 37) + '…' : txt, A4.margin + i * colW + 1.5, y + 4.2, {
          maxWidth: colW - 3,
        });
      });
      y += 6;
    });

    y += 2;
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    const recordsLabel = labels.records.replace('{{count}}', String(rows.length));
    ensureSpace(8);
    doc.text(recordsLabel, A4.margin, y + 4);
    doc.setTextColor(0, 0, 0);
  }

  doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
}

// ---------------------------------------------------------------------------
// Multi-sheet Excel export (SheetJS)
// ---------------------------------------------------------------------------

function autoCols(aoa: (string | number)[][]): { wch: number }[] {
  if (!aoa.length) return [];
  const widths: number[] = [];
  for (const row of aoa) {
    row.forEach((cell, i) => {
      const len = String(cell ?? '').length;
      widths[i] = Math.max(widths[i] ?? 8, len);
    });
  }
  return widths.map((w) => ({ wch: Math.min(50, w + 2) }));
}

/** Sanitise a string into a valid (<=31 char, no forbidden chars) Excel sheet name. */
function sheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet';
  let candidate = base;
  let n = 1;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 26)} ${++n}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Export a workbook with a Summary sheet (KPIs), one sheet per chart
 * (underlying series so the user can build a native Excel chart) and a
 * Detail sheet (table rows via the per-type columns).
 */
export function exportReportExcel(opts: {
  filename: string;
  model: ReportModel;
  rows: Row[];
  labels: { summary: string; detail: string; metric: string; value: string };
}): void {
  const { filename, model, rows, labels } = opts;
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  // Summary sheet — KPI label/value pairs.
  const summaryAoa: (string | number)[][] = [
    [labels.metric, labels.value],
    ...model.kpis.map((k) => [k.label, k.value]),
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa);
  summaryWs['!cols'] = autoCols(summaryAoa);
  XLSX.utils.book_append_sheet(wb, summaryWs, sheetName(labels.summary, used));

  // One sheet per chart — the chart's underlying series as a table.
  for (const chart of model.charts) {
    if (!chart.data.length) continue;
    const header = [chart.xKey, ...chart.series.map((s) => s.name)];
    const body = chart.data.map((d) => [
      String((d as any)[chart.xKey] ?? ''),
      ...chart.series.map((s) => {
        const v = (d as any)[s.key];
        return v == null ? '' : (typeof v === 'number' ? v : String(v));
      }),
    ]);
    const aoa = [header, ...body];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = autoCols(aoa as (string | number)[][]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(chart.title, used));
  }

  // Detail sheet — table rows.
  const detailAoa: (string | number)[][] = [
    model.columns.map((c) => c.label),
    ...rows.map((r) => model.columns.map((c) => cellText(r, c))),
  ];
  const detailWs = XLSX.utils.aoa_to_sheet(detailAoa);
  detailWs['!cols'] = autoCols(detailAoa);
  XLSX.utils.book_append_sheet(wb, detailWs, sheetName(labels.detail, used));

  XLSX.writeFile(wb, `${filename}.xlsx`);
}
