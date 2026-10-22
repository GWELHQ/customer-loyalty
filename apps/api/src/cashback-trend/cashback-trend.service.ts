import { Injectable, Logger } from '@nestjs/common';
import type {
  CashbackMonthlyTotal,
  CashbackMonthlyTotalSource,
  CashbackTrendReport,
  CashbackTrendSettings,
  Station,
} from '@loyalty/shared';
import type { EmailAttachment, EmailSendResult } from '../common/email/email-provider.interface';
import { EmailService } from '../common/email/email.service';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import {
  TREND_CHART_CID,
  trendChartPng,
  trendTableHtml,
  trendToPdfBuffer,
  trendToXlsxBuffer,
} from './cashback-trend-export';

const TOTALS_COLLECTION = 'cashbackMonthlyTotals';
const SETTINGS_COLLECTION = 'cashbackTrendSettings';
const SETTINGS_ID = 'default';
const EMAILS_COLLECTION = 'cashbackTrendEmails';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Row order matches the finance spreadsheet this report replaces; any other station follows alphabetically. */
const STATION_ORDER = ['CBD', 'KSM1', 'MBT', 'UGJA', 'UGJB', 'ROD'];

export interface TrendFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The finance spreadsheet calls the CBD branch "CBD" even though the station record is named "Kisumu 2". */
export function stationLabel(station: Pick<Station, 'code' | 'name'>): string {
  return station.code === 'CBD' ? 'CBD' : station.name.toUpperCase();
}

@Injectable()
export class CashbackTrendService {
  private readonly logger = new Logger('CashbackTrendService');

  constructor(
    private readonly firestore: FirestoreService,
    private readonly email: EmailService,
  ) {}

  // ---- settings -----------------------------------------------------------

  private settingsDoc() {
    return this.firestore.collection(SETTINGS_COLLECTION).doc(SETTINGS_ID);
  }

  async getSettings(): Promise<CashbackTrendSettings> {
    const snap = await this.settingsDoc().get();
    if (snap.exists) return fromDoc<CashbackTrendSettings>(snap);
    const now = nowIso();
    const doc: Omit<CashbackTrendSettings, 'id'> = { autoRecipients: [], createdAt: now, updatedAt: now };
    await this.settingsDoc().set(doc);
    return { ...doc, id: SETTINGS_ID };
  }

  async updateSettings(autoRecipients: string[]): Promise<CashbackTrendSettings> {
    await this.getSettings();
    const unique = [...new Set(autoRecipients.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    await this.settingsDoc().update({ autoRecipients: unique, updatedAt: nowIso() });
    return this.getSettings();
  }

  // ---- totals -------------------------------------------------------------

  private totalsCol() {
    return this.firestore.collection(TOTALS_COLLECTION);
  }

  async listStations(): Promise<Station[]> {
    const snap = await this.firestore.collection('stations').get();
    return snap.docs.map((d) => fromDoc<Station>(d));
  }

  /**
   * Writes one (month, station) total. A figure may only be overwritten by
   * the same kind of source: auto-recorded ('system') figures never replace a
   * seeded or manually corrected one — those are the numbers finance
   * reconciled by hand, and a half-migrated month in this system must not
   * clobber them. A 'manual' correction can replace anything. Returns whether
   * the write happened.
   */
  async upsertTotal(
    input: { month: string; stationId: string; stationName: string; amount: number },
    source: CashbackMonthlyTotalSource,
  ): Promise<boolean> {
    const id = `${input.month}_${input.stationId}`;
    const ref = this.totalsCol().doc(id);
    const existing = await ref.get();
    const now = nowIso();
    if (existing.exists) {
      const current = fromDoc<CashbackMonthlyTotal>(existing);
      if (source !== 'manual' && current.source !== source) return false;
      await ref.update({ amount: round2(input.amount), stationName: input.stationName, source, updatedAt: now });
      return true;
    }
    const doc: Omit<CashbackMonthlyTotal, 'id'> = {
      month: input.month,
      stationId: input.stationId,
      stationName: input.stationName,
      amount: round2(input.amount),
      source,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(doc);
    return true;
  }

  async listTotals(): Promise<CashbackMonthlyTotal[]> {
    const snap = await this.totalsCol().get();
    return snap.docs.map((d) => fromDoc<CashbackMonthlyTotal>(d));
  }

  // ---- report -------------------------------------------------------------

  /** Strict year-to-date: January through the latest month with data, within that month's year. */
  async buildReport(): Promise<CashbackTrendReport> {
    const [totals, stations] = await Promise.all([this.listTotals(), this.listStations()]);
    const latest = totals.reduce((max, t) => (t.month > max ? t.month : max), '');
    if (!latest) {
      return { year: new Date().getFullYear(), months: [], monthLabels: [], rows: [], monthTotals: [], grandTotal: 0 };
    }

    const year = Number(latest.slice(0, 4));
    const lastMonthIndex = Number(latest.slice(5, 7));
    const months = Array.from({ length: lastMonthIndex }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const stationById = new Map(stations.map((s) => [s.id, s]));

    const byStation = new Map<string, Map<string, number>>();
    for (const t of totals) {
      if (!months.includes(t.month)) continue;
      const perMonth = byStation.get(t.stationId) ?? new Map<string, number>();
      perMonth.set(t.month, round2((perMonth.get(t.month) ?? 0) + t.amount));
      byStation.set(t.stationId, perMonth);
    }

    const rows = [...byStation.entries()]
      .map(([stationId, perMonth]) => {
        const station = stationById.get(stationId);
        const values = months.map((m) => perMonth.get(m) ?? null);
        const fallbackName = totals.find((t) => t.stationId === stationId)?.stationName ?? stationId;
        return {
          stationId,
          stationName: station ? stationLabel(station) : fallbackName,
          code: station?.code ?? '',
          values,
          total: round2(values.reduce<number>((sum, v) => sum + (v ?? 0), 0)),
        };
      })
      .sort((a, b) => {
        const ai = STATION_ORDER.indexOf(a.code);
        const bi = STATION_ORDER.indexOf(b.code);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        return a.stationName.localeCompare(b.stationName);
      })
      .map(({ code: _code, ...row }) => row);

    const monthTotals = months.map((_, i) => round2(rows.reduce((sum, r) => sum + (r.values[i] ?? 0), 0)));
    return {
      year,
      months,
      monthLabels: months.map((m) => MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m),
      rows,
      monthTotals,
      grandTotal: round2(monthTotals.reduce((a, b) => a + b, 0)),
    };
  }

  reportTitle(report: CashbackTrendReport): string {
    if (report.months.length === 0) return 'Paid-Out Cashback Trend';
    const first = report.monthLabels[0];
    const last = report.monthLabels[report.monthLabels.length - 1];
    return `Paid-Out Cashback Trend - ${first}${report.months.length > 1 ? ` to ${last}` : ''} ${report.year}`;
  }

  async exportFiles(report: CashbackTrendReport): Promise<{ xlsx: TrendFile; pdf: TrendFile | null; chart: Buffer | null }> {
    // The chart is decoration on top of the table: if rendering it fails the
    // report still goes out with the numbers rather than not at all.
    let chart: Buffer | null = null;
    try {
      chart = report.rows.length > 0 ? trendChartPng(report) : null;
    } catch (err) {
      this.logger.error('Trend chart rendering failed - continuing without it', err instanceof Error ? err.stack : err);
    }
    const stem = `cashback-trend-${report.year}`;
    const xlsx: TrendFile = {
      filename: `${stem}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: await trendToXlsxBuffer(report, chart),
    };
    let pdf: TrendFile | null = null;
    try {
      pdf = {
        filename: `${stem}.pdf`,
        contentType: 'application/pdf',
        bytes: trendToPdfBuffer(report, this.reportTitle(report), chart),
      };
    } catch (err) {
      this.logger.error('Trend PDF generation failed - sending without it', err instanceof Error ? err.stack : err);
    }
    return { xlsx, pdf, chart };
  }

  async sendReport(
    recipients: string[],
    opts: { cc?: string[]; replyTo?: string; subject?: string; body?: string } = {},
  ): Promise<EmailSendResult> {
    const report = await this.buildReport();
    if (report.months.length === 0) return { success: false, errorReason: 'No disbursed months to report yet' };
    const title = this.reportTitle(report);
    const { xlsx, pdf, chart } = await this.exportFiles(report);

    const attachments: EmailAttachment[] = [
      { filename: xlsx.filename, contentType: xlsx.contentType, contentBytes: xlsx.bytes },
    ];
    if (pdf) attachments.push({ filename: pdf.filename, contentType: pdf.contentType, contentBytes: pdf.bytes });
    if (chart) {
      attachments.push({
        filename: 'cashback-trend-chart.png',
        contentType: 'image/png',
        contentBytes: chart,
        inlineContentId: TREND_CHART_CID,
      });
    }
    const lastLabel = report.monthLabels[report.monthLabels.length - 1];
    const intro =
      opts.body?.trim() ||
      `Cashback paid out to loyalty customers, by station, from January to ${lastLabel} ${report.year}. The same report is attached as XLSX and PDF.`;
    return this.email.send(
      recipients,
      opts.subject?.trim() || title,
      { title, bodyLines: [intro], bodyHtml: trendTableHtml(report, chart ? { cid: TREND_CHART_CID } : null) },
      { cc: opts.cc, replyTo: opts.replyTo, attachments },
    );
  }

  // ---- automatic flow -----------------------------------------------------

  /**
   * Called once a month's every-station disbursement has completed. Records
   * the paid totals per station, then emails the refreshed trend report to
   * the configured recipients - at most once per month. Never throws: the
   * disbursement that triggered it has already succeeded and must not be
   * reported as failed because of a reporting problem.
   */
  async onMonthDisbursed(month: string, paidByStation: { stationId: string; amount: number }[]): Promise<void> {
    try {
      const stations = await this.listStations();
      const stationById = new Map(stations.map((s) => [s.id, s]));
      let recordedAny = false;
      for (const paid of paidByStation) {
        const station = stationById.get(paid.stationId);
        const wrote = await this.upsertTotal(
          {
            month,
            stationId: paid.stationId,
            stationName: station ? stationLabel(station) : paid.stationId,
            amount: paid.amount,
          },
          'system',
        );
        recordedAny = recordedAny || wrote;
      }
      // A month whose figures were seeded/corrected by hand was already reported on.
      if (!recordedAny) return;

      const sentRef = this.firestore.collection(EMAILS_COLLECTION).doc(month);
      if ((await sentRef.get()).exists) return;
      const { autoRecipients } = await this.getSettings();
      if (autoRecipients.length === 0) {
        this.logger.warn(`Cashback trend for ${month} recorded, but no automatic recipients are configured - not emailed`);
        return;
      }
      const result = await this.sendReport(autoRecipients);
      if (result.success) {
        await sentRef.set({ month, recipients: autoRecipients, sentAt: nowIso() });
      } else {
        this.logger.warn(`Automatic cashback trend email for ${month} failed: ${result.errorReason}`);
      }
    } catch (err) {
      this.logger.error(`Cashback trend post-disbursement step failed for ${month}`, err instanceof Error ? err.stack : err);
    }
  }
}
