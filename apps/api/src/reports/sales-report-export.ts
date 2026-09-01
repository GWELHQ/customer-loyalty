import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { utils, write } from 'xlsx';
import type { SalesReportGroup } from '@loyalty/shared';

/**
 * Server-side twin of apps/web/src/lib/exportTable.ts's exportToXlsx/
 * exportToPdf — same columns/library calls, but returning a Buffer
 * instead of triggering a browser download (`XLSX.write(..., {type:
 * 'buffer'})` / `doc.output('arraybuffer')` in place of `writeFile`/
 * `doc.save()`), so a sales report can be attached to an email.
 */

function columns(groupLabel: string): { header: string; value: (g: SalesReportGroup) => string | number }[] {
  return [
    { header: groupLabel, value: (g) => g.label },
    { header: 'Sales', value: (g) => g.count },
    { header: 'Amount (KSh)', value: (g) => g.amount },
    { header: 'Cashback (KSh)', value: (g) => g.cashback },
  ];
}

export function salesReportToXlsxBuffer(groupLabel: string, groups: SalesReportGroup[]): Buffer {
  const cols = columns(groupLabel);
  const data = groups.map((g) => {
    const record: Record<string, string | number> = {};
    for (const col of cols) record[col.header] = col.value(g);
    return record;
  });
  const sheet = utils.json_to_sheet(data, { header: cols.map((c) => c.header) });
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, 'Data');
  return write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function salesReportToPdfBuffer(title: string, groupLabel: string, groups: SalesReportGroup[]): Buffer {
  const cols = columns(groupLabel);
  const doc = new jsPDF({ orientation: 'portrait' });
  doc.setFontSize(13);
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString('en-KE')} — ${groups.length} row(s)`, 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [cols.map((c) => c.header)],
    body: groups.map((g) => cols.map((c) => String(c.value(g)))),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [17, 61, 133] },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  // doc.output() returns jsPDF's raw "binary string" (one char per byte) —
  // converting via Node's own latin1 decoding is the standard, well-worn
  // path for this, rather than routing through jsPDF's own internal
  // ArrayBuffer helper (`.output('arraybuffer')`). Verified byte-identical
  // to that helper's output in testing; kept as the more defensible of the
  // two since it relies on one fewer internal jsPDF code path.
  const buffer = Buffer.from(doc.output(), 'latin1');
  if (!looksLikeValidPdf(buffer)) {
    throw new Error('Generated PDF failed basic integrity validation (missing %PDF header or %%EOF trailer)');
  }
  return buffer;
}

/** Cheap sanity check — not a full parse, just enough to catch an obviously truncated/corrupt buffer before it's emailed out. */
function looksLikeValidPdf(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 5).toString('latin1');
  const tail = buffer.subarray(-32).toString('latin1');
  return head === '%PDF-' && tail.includes('%%EOF');
}

/** Inline-styled HTML <table> for embedding directly in an email body (values pre-formatted, not escaped — group labels come from this app's own denormalized sale data, not free-form user input). */
export function salesReportToHtmlTable(groupLabel: string, groups: SalesReportGroup[]): string {
  const cols = columns(groupLabel);
  const headCells = cols
    .map(
      (c) =>
        `<th style="text-align:left;padding:8px 10px;background:#003a88;color:#ffffff;font-size:12px;">${escapeHtml(c.header)}</th>`,
    )
    .join('');
  const rows = groups
    .map((g, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f5f7fa';
      const cells = cols
        .map((c) => `<td style="padding:7px 10px;font-size:12.5px;background:${bg};border-bottom:1px solid #dbe0e1;">${escapeHtml(String(c.value(g)))}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-collapse:collapse;"><thead><tr>${headCells}</tr></thead><tbody>${rows}</tbody></table>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
