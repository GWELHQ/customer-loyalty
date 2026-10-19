import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { utils, writeFile } from 'xlsx';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

/** A final totals row, one cell per column in column order (use '' for columns with no total). */
export type ExportTotals = (string | number)[];

/** Generates and downloads an .xlsx workbook from `rows`, one sheet, using `columns` for headers/ordering. */
export function exportToXlsx<T>(filename: string, columns: ExportColumn<T>[], rows: T[], totals?: ExportTotals): void {
  const data = rows.map((row) => {
    const record: Record<string, string | number> = {};
    for (const col of columns) record[col.header] = col.value(row);
    return record;
  });
  if (totals) data.push(Object.fromEntries(columns.map((c, i) => [c.header, totals[i] ?? ''])));
  const sheet = utils.json_to_sheet(data, { header: columns.map((c) => c.header) });
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, 'Data');
  writeFile(book, `${filename}.xlsx`);
}

/** Generates and downloads a PDF table from `rows`. Landscape once there are enough columns to need it. */
export function exportToPdf<T>(filename: string, title: string, columns: ExportColumn<T>[], rows: T[], totals?: ExportTotals): void {
  const doc = new jsPDF({ orientation: columns.length > 5 ? 'landscape' : 'portrait' });
  doc.setFontSize(13);
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Exported ${new Date().toLocaleString('en-KE')} — ${rows.length} row(s)`, 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => String(c.value(row)))),
    ...(totals ? { foot: [columns.map((_, i) => String(totals[i] ?? ''))] } : {}),
    footStyles: { fillColor: [225, 232, 245], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [17, 61, 133] },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  doc.save(`${filename}.pdf`);
}
