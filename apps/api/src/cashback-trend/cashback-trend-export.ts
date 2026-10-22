import { Resvg } from '@resvg/resvg-js';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CashbackTrendReport } from '@loyalty/shared';

/**
 * Renderers for the YTD paid-out cashback trend: the line chart (as PNG),
 * and the table as inline-email HTML, XLSX and PDF. Everything is built from
 * one CashbackTrendReport so the email body, the PDF and the workbook can
 * never disagree with each other.
 */

const SERIES_COLORS = ['#1f5f8b', '#ed7d31', '#2e7d32', '#1fa3d9', '#8e24aa', '#d81b60', '#6d4c41', '#546e7a'];
const FONT_FAMILY = 'DejaVu Sans';
const CHART_WIDTH = 900;
const CHART_HEIGHT = 420;

export function formatKsh(value: number | null): string {
  if (value === null) return '';
  return value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Rounds a chart maximum up to a "nice" gridline step so the axis ends on a round number. */
function niceAxis(maxValue: number): { max: number; step: number } {
  if (maxValue <= 0) return { max: 1, step: 1 };
  const rawStep = maxValue / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? 10 * magnitude;
  return { max: Math.ceil(maxValue / step) * step, step };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function trendChartSvg(report: CashbackTrendReport): string {
  const margin = { top: 56, right: 28, bottom: 78, left: 92 };
  const plotW = CHART_WIDTH - margin.left - margin.right;
  const plotH = CHART_HEIGHT - margin.top - margin.bottom;
  const allValues = report.rows.flatMap((r) => r.values.filter((v): v is number => v !== null));
  const { max, step } = niceAxis(Math.max(0, ...allValues));
  const xFor = (i: number) =>
    margin.left + (report.months.length === 1 ? plotW / 2 : (i / (report.months.length - 1)) * plotW);
  const yFor = (v: number) => margin.top + plotH - (v / max) * plotH;

  const parts: string[] = [];
  parts.push(`<rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${CHART_WIDTH / 2}" y="32" text-anchor="middle" font-size="22" font-weight="bold" fill="#6b6b6b">Trend Analysis</text>`,
  );

  for (let v = 0; v <= max + step / 2; v += step) {
    const y = yFor(v);
    parts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="#d9d9d9" stroke-width="1"/>`);
    parts.push(
      `<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#595959">${escapeXml(formatKsh(v))}</text>`,
    );
  }
  report.monthLabels.forEach((label, i) => {
    parts.push(
      `<text x="${xFor(i)}" y="${margin.top + plotH + 22}" text-anchor="middle" font-size="12" fill="#595959">${escapeXml(label)}</text>`,
    );
  });

  report.rows.forEach((row, ri) => {
    const color = (SERIES_COLORS[ri % SERIES_COLORS.length] ?? '#1f5f8b');
    // A null month (e.g. Rodi before it opened) breaks the line instead of dropping it to zero.
    let path = '';
    let penDown = false;
    row.values.forEach((v, i) => {
      if (v === null) {
        penDown = false;
        return;
      }
      path += `${penDown ? 'L' : 'M'}${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)} `;
      penDown = true;
    });
    if (path) parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`);
    // A single isolated point (a station with one month of data) would be invisible as a line.
    row.values.forEach((v, i) => {
      if (v === null) return;
      const lonely = (i === 0 || row.values[i - 1] === null) && (i === row.values.length - 1 || row.values[i + 1] === null);
      if (lonely) parts.push(`<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="3.5" fill="${color}"/>`);
    });
  });

  // Legend, centred under the plot.
  const legendY = CHART_HEIGHT - 22;
  const itemWidths = report.rows.map((r) => 34 + r.stationName.length * 8);
  let lx = (CHART_WIDTH - itemWidths.reduce((a, b) => a + b, 0)) / 2;
  report.rows.forEach((row, ri) => {
    const color = (SERIES_COLORS[ri % SERIES_COLORS.length] ?? '#1f5f8b');
    parts.push(`<line x1="${lx}" y1="${legendY - 4}" x2="${lx + 22}" y2="${legendY - 4}" stroke="${color}" stroke-width="2.5"/>`);
    parts.push(`<text x="${lx + 28}" y="${legendY}" font-size="12" fill="#595959">${escapeXml(row.stationName)}</text>`);
    lx += itemWidths[ri] ?? 0;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" font-family="${FONT_FAMILY}">${parts.join('')}</svg>`;
}

/**
 * The slim container the API runs in has no system fonts, so the text in the
 * chart would render blank. DejaVu Sans is bundled via an npm package and
 * handed to the renderer explicitly instead of relying on the host.
 */
function fontFiles(): string[] {
  try {
    const dir = require.resolve('dejavu-fonts-ttf/package.json').replace(/package\.json$/, '');
    return [`${dir}ttf/DejaVuSans.ttf`, `${dir}ttf/DejaVuSans-Bold.ttf`];
  } catch {
    return [];
  }
}

export function trendChartPng(report: CashbackTrendReport): Buffer {
  const resvg = new Resvg(trendChartSvg(report), {
    font: { fontFiles: fontFiles(), loadSystemFonts: true, defaultFontFamily: FONT_FAMILY },
    fitTo: { mode: 'width', value: CHART_WIDTH * 2 },
  });
  return Buffer.from(resvg.render().asPng());
}

export const TREND_CHART_CID = 'cashback-trend-chart';

export function trendTableHtml(report: CashbackTrendReport, chart: { cid: string } | null): string {
  const th = (text: string, align: 'left' | 'right' = 'right') =>
    `<th style="text-align:${align};padding:6px 8px;background:#003a88;color:#ffffff;font-size:11px;white-space:nowrap;">${escapeXml(text)}</th>`;
  const td = (text: string, opts: { bold?: boolean; align?: 'left' | 'right'; bg?: string; color?: string } = {}) =>
    `<td style="text-align:${opts.align ?? 'right'};padding:6px 8px;font-size:11.5px;white-space:nowrap;border-bottom:1px solid #dbe0e1;background:${opts.bg ?? '#ffffff'};${opts.bold ? 'font-weight:700;' : ''}${opts.color ? `color:${opts.color};` : ''}">${escapeXml(text)}</td>`;

  const head = `<tr>${th('Station', 'left')}${report.monthLabels.map((l) => th(l)).join('')}${th('Grand Total')}</tr>`;
  const body = report.rows
    .map((r, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f5f7fa';
      return `<tr>${td(r.stationName, { align: 'left', bold: true, bg })}${r.values.map((v) => td(formatKsh(v), { bg })).join('')}${td(formatKsh(r.total), { bold: true, bg })}</tr>`;
    })
    .join('');
  const foot = `<tr>${td('Total', { align: 'left', bold: true, bg: '#eef2f7', color: '#c00000' })}${report.monthTotals
    .map((v) => td(formatKsh(v), { bold: true, bg: '#eef2f7', color: '#c00000' }))
    .join('')}${td(formatKsh(report.grandTotal), { bold: true, bg: '#eef2f7', color: '#c00000' })}</tr>`;

  const table = `<div style="overflow-x:auto;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 16px;"><thead>${head}</thead><tbody>${body}${foot}</tbody></table></div>`;
  const image = chart
    ? `<img src="cid:${chart.cid}" alt="Cashback trend chart" width="720" style="display:block;max-width:100%;height:auto;margin:8px 0;"/>`
    : '';
  return table + image;
}

export async function trendToXlsxBuffer(report: CashbackTrendReport, chartPng: Buffer | null): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Cashback Trend');
  const header = ['Station', ...report.monthLabels, 'Grand Total'];
  sheet.addRow(header);
  for (const r of report.rows) sheet.addRow([r.stationName, ...r.values.map((v) => v ?? ''), r.total]);
  sheet.addRow([]);
  const totals = sheet.addRow(['Total', ...report.monthTotals, report.grandTotal]);

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF003A88' } };
  totals.font = { bold: true, color: { argb: 'FFC00000' } };
  sheet.getColumn(1).width = 16;
  for (let c = 2; c <= header.length; c++) {
    sheet.getColumn(c).width = c === header.length ? 16 : 13;
    sheet.getColumn(c).numFmt = '#,##0.00';
  }

  if (chartPng) {
    const imageId = book.addImage({ buffer: chartPng as unknown as ExcelJS.Buffer, extension: 'png' });
    sheet.addImage(imageId, { tl: { col: 0, row: report.rows.length + 4 }, ext: { width: CHART_WIDTH * 0.85, height: CHART_HEIGHT * 0.85 } });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function trendToPdfBuffer(report: CashbackTrendReport, title: string, chartPng: Buffer | null): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', compress: true });
  doc.setFontSize(14);
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString('en-KE')}`, 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [['Station', ...report.monthLabels, 'Grand Total']],
    body: report.rows.map((r) => [r.stationName, ...r.values.map(formatKsh), formatKsh(r.total)]),
    foot: [['Total', ...report.monthTotals.map(formatKsh), formatKsh(report.grandTotal)]],
    showFoot: 'lastPage',
    styles: { fontSize: 8, cellPadding: 2.5, halign: 'right' },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
    headStyles: { fillColor: [0, 58, 136], halign: 'right' },
    footStyles: { fillColor: [238, 242, 247], textColor: [192, 0, 0], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  if (chartPng) {
    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const width = Math.min(pageW - 28, 200);
    const height = (width * CHART_HEIGHT) / CHART_WIDTH;
    let y = finalY + 8;
    if (y + height > pageH - 10) {
      doc.addPage();
      y = 14;
    }
    doc.addImage(chartPng, 'PNG', (pageW - width) / 2, y, width, height, undefined, 'FAST');
  }

  const buffer = Buffer.from(doc.output(), 'latin1');
  const head = buffer.subarray(0, 5).toString('latin1');
  if (head !== '%PDF-' || !buffer.subarray(-32).toString('latin1').includes('%%EOF')) {
    throw new Error('Generated PDF failed basic integrity validation (missing %PDF header or %%EOF trailer)');
  }
  return buffer;
}
