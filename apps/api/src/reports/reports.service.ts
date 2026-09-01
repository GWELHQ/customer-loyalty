import { Injectable, Logger } from '@nestjs/common';
import {
  Product,
  ReconciliationStatus,
  SpecialRateStatus,
  type Sale,
  type SalesReportGroup,
  type SalesReportGroupBy,
  type Station,
} from '@loyalty/shared';
import type { EmailAttachment, EmailSendResult } from '../common/email/email-provider.interface';
import { EmailService } from '../common/email/email.service';
import { formatEmailDate } from '../common/email/render-email';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc } from '../common/firestore/helpers';
import {
  nairobiDateKey,
  nairobiDayBoundsUtc,
  nairobiMonthBoundsUtc,
  nairobiMonthKey,
  nairobiShiftBucket,
  nairobiToday,
} from '../common/time/nairobi';
import type { StaffPrincipal } from '../common/types/principal';
import { salesReportToHtmlTable, salesReportToPdfBuffer, salesReportToXlsxBuffer } from './sales-report-export';

const GROUP_LABEL: Record<SalesReportGroupBy, string> = {
  attendant: 'Attendant',
  station: 'Station',
  shift: 'Shift',
  product: 'Product',
};

// A full year for a busy business can exceed the previous 1000-row cap
// (originally sized for a single month's "sales by product" view) — this
// is still an in-memory-aggregation limit, not true server-side
// aggregation, so it's a known scaling ceiling rather than a hard
// guarantee of completeness for very large date ranges.
const SALES_REPORT_LIMIT = 5000;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger('ReportsService');

  constructor(
    private readonly firestore: FirestoreService,
    private readonly email: EmailService,
  ) {}

  async dashboard(stationId?: string) {
    const today = nairobiToday();
    const monthStart = nairobiMonthBoundsUtc(nairobiMonthKey()).startUtc;

    let salesQuery = this.firestore
      .collection('sales')
      .where('saleDate', '>=', monthStart) as FirebaseFirestore.Query;
    if (stationId) salesQuery = salesQuery.where('stationId', '==', stationId);
    const salesSnap = await salesQuery.get();
    const sales = salesSnap.docs.map((d) => fromDoc<Sale>(d));

    const totalCashbackMonth = round2(sales.reduce((s, x) => s + x.snapshot.cashbackEarned, 0));
    const totalSalesAmountMonth = round2(sales.reduce((s, x) => s + x.amountPaid, 0));
    const uniqueCustomers = new Set(sales.map((s) => s.customerId)).size;

    // specialRateRequests has no stationId — this count is unavoidably
    // company-wide, so only surface it to an unscoped (all-stations)
    // caller. A station-scoped role (station_supervisor) doesn't hold
    // SPECIAL_RATES_VIEW at all; returning null here (rather than a
    // sitewide count) keeps this endpoint from being the one place that
    // leaks it to them.
    const pendingSpecialRateRequests = stationId
      ? null
      : (
          await this.firestore
            .collection('specialRateRequests')
            .where('status', '==', SpecialRateStatus.PENDING)
            .count()
            .get()
        ).data().count;

    let reconQuery = this.firestore.collection('reconciliationDaily').where('date', '==', today) as FirebaseFirestore.Query;
    if (stationId) reconQuery = reconQuery.where('stationId', '==', stationId);
    const reconSnap = await reconQuery.get();
    const needsAttention = reconSnap.docs.filter((d) => {
      const status = d.data().status as ReconciliationStatus;
      return status === ReconciliationStatus.EXCEEDED || status === ReconciliationStatus.NEEDS_REVIEW;
    }).length;

    const trend = await this.salesTrend(stationId);
    const stationTotals = stationId ? null : await this.todayStationTotals(sales, today);

    return {
      month: today.slice(0, 7),
      totalCashbackMonth,
      totalSalesAmountMonth,
      saleCount: sales.length,
      uniqueCustomers,
      pendingSpecialRateRequests,
      reconciliationRecordsNeedingAttention: needsAttention,
      trend,
      stationTotals,
    };
  }

  /** Last 7 Nairobi calendar days of loyalty sales amount, split by product — a fixed rolling window, independent of the calendar month boundary the rest of `dashboard()` uses. */
  private async salesTrend(stationId?: string): Promise<Array<{ date: string; label: string; pms: number; ago: number }>> {
    const today = nairobiToday();
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${today}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const startUtc = nairobiDayBoundsUtc(dayKeys[0]!).startUtc;

    let query = this.firestore.collection('sales').where('saleDate', '>=', startUtc) as FirebaseFirestore.Query;
    if (stationId) query = query.where('stationId', '==', stationId);
    const snap = await query.get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));

    const byDay = new Map<string, { pms: number; ago: number }>();
    for (const key of dayKeys) byDay.set(key, { pms: 0, ago: 0 });
    for (const sale of sales) {
      const bucket = byDay.get(nairobiDateKey(sale.saleDate));
      if (!bucket) continue;
      if (sale.product === Product.PMS) bucket.pms += sale.amountPaid;
      else if (sale.product === Product.AGO) bucket.ago += sale.amountPaid;
    }

    return [...byDay.entries()].map(([date, v]) => ({
      date,
      label: new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-KE', { weekday: 'short', timeZone: 'UTC' }),
      pms: round2(v.pms),
      ago: round2(v.ago),
    }));
  }

  /** Today's (Nairobi calendar day) loyalty sales amount per station — only meaningful for an unscoped (all-stations) view. */
  private async todayStationTotals(
    monthToDateSales: Sale[],
    today: string,
  ): Promise<Array<{ stationId: string; name: string; value: number }>> {
    const stationsSnap = await this.firestore.collection('stations').orderBy('name').get();
    const stations = stationsSnap.docs.map((d) => fromDoc<Station>(d));

    const byStation = new Map<string, number>();
    for (const sale of monthToDateSales) {
      if (nairobiDateKey(sale.saleDate) !== today) continue;
      byStation.set(sale.stationId, (byStation.get(sale.stationId) ?? 0) + sale.amountPaid);
    }

    return stations.map((s) => ({ stationId: s.id, name: s.name, value: round2(byStation.get(s.id) ?? 0) }));
  }

  async salesReport(filters: { stationId?: string; from?: string; to?: string; groupBy?: SalesReportGroupBy }) {
    let query = this.firestore.collection('sales').orderBy('saleDate', 'desc') as FirebaseFirestore.Query;
    if (filters.stationId) query = query.where('stationId', '==', filters.stationId);
    if (filters.from) query = query.where('saleDate', '>=', filters.from);
    if (filters.to) query = query.where('saleDate', '<=', filters.to);
    const snap = await query.limit(SALES_REPORT_LIMIT).get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));

    const byProduct: Record<string, { count: number; amount: number; cashback: number }> = {};
    for (const sale of sales) {
      const bucket = (byProduct[sale.product] ??= { count: 0, amount: 0, cashback: 0 });
      bucket.count += 1;
      bucket.amount = round2(bucket.amount + sale.amountPaid);
      bucket.cashback = round2(bucket.cashback + sale.snapshot.cashbackEarned);
    }

    const groupBy = filters.groupBy ?? 'product';
    const groups = groupSales(sales, groupBy);

    return { sales, byProduct, groupBy, groups };
  }

  /** Re-runs salesReport() server-side (never trusts a client-submitted rows/columns blob) and emails the result. */
  async emailSalesReport(
    filters: { stationId?: string; from?: string; to?: string; groupBy?: SalesReportGroupBy },
    email: { recipients: string[]; cc?: string[]; subject?: string; body?: string },
    actor: StaffPrincipal,
  ): Promise<EmailSendResult> {
    const { groupBy, groups } = await this.salesReport(filters);
    const groupLabel = GROUP_LABEL[groupBy];
    const rangeLabel = describeRange(filters.from, filters.to);
    const subject = email.subject?.trim() || `Loyalty Sales By ${groupLabel} — ${rangeLabel}`;
    const introLine =
      email.body?.trim() || `Loyalty sales by ${groupLabel.toLowerCase()} for ${rangeLabel}, attached as XLSX and PDF.`;

    const attachments: EmailAttachment[] = [
      {
        filename: 'sales-report.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        contentBytes: salesReportToXlsxBuffer(groupLabel, groups),
      },
    ];
    // A malformed PDF is worse than no PDF — the recipient still gets the
    // XLSX and the inline table either way, so a generation failure here
    // degrades gracefully instead of failing (or silently corrupting) the
    // whole send.
    try {
      attachments.push({
        filename: 'sales-report.pdf',
        contentType: 'application/pdf',
        contentBytes: salesReportToPdfBuffer(subject, groupLabel, groups),
      });
    } catch (err) {
      this.logger.error('PDF report generation failed — sending without it', err instanceof Error ? err.stack : err);
    }

    return this.email.send(
      email.recipients,
      subject,
      { title: subject, bodyLines: [introLine], bodyHtml: salesReportToHtmlTable(groupLabel, groups) },
      {
        cc: email.cc,
        replyTo: actor.email,
        attachments,
      },
    );
  }

  async reconciliationReport(filters: { stationId?: string; date?: string }) {
    let query = this.firestore.collection('reconciliationDaily').orderBy('date', 'desc') as FirebaseFirestore.Query;
    if (filters.stationId) query = query.where('stationId', '==', filters.stationId);
    if (filters.date) query = query.where('date', '==', filters.date);
    const snap = await query.limit(500).get();
    return snap.docs.map((d) => d.data());
  }

  async disbursementsReport(month?: string) {
    let query = this.firestore.collection('disbursementBatches').orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (month) query = query.where('month', '==', month);
    const snap = await query.get();
    return snap.docs.map((d) => d.data());
  }

  async customerActivityReport(customerId: string) {
    const [salesSnap, customerSnap] = await Promise.all([
      this.firestore.collection('sales').where('customerId', '==', customerId).orderBy('saleDate', 'desc').limit(200).get(),
      this.firestore.collection('customers').doc(customerId).get(),
    ]);
    return {
      customer: customerSnap.exists ? { id: customerSnap.id, ...customerSnap.data() } : null,
      sales: salesSnap.docs.map((d) => fromDoc<Sale>(d)),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function groupSales(sales: Sale[], groupBy: SalesReportGroupBy): SalesReportGroup[] {
  const buckets = new Map<string, SalesReportGroup>();
  for (const sale of sales) {
    const [key, label] =
      groupBy === 'attendant'
        ? [sale.attendantId, sale.attendantNameAtSale]
        : groupBy === 'station'
          ? [sale.stationId, sale.stationNameAtSale]
          : groupBy === 'shift'
            ? shiftKeyAndLabel(sale.saleDate)
            : [sale.product, sale.product];
    const bucket = buckets.get(key) ?? { key, label, count: 0, amount: 0, cashback: 0 };
    bucket.count += 1;
    bucket.amount = round2(bucket.amount + sale.amountPaid);
    bucket.cashback = round2(bucket.cashback + sale.snapshot.cashbackEarned);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.amount - a.amount);
}

function shiftKeyAndLabel(saleDateIso: string): [string, string] {
  const { shift } = nairobiShiftBucket(saleDateIso);
  return [shift, shift === 'day' ? 'Day' : 'Night'];
}

function describeRange(from?: string, to?: string): string {
  if (!from && !to) return 'all time';
  if (from && to) return `${formatEmailDate(from)} – ${formatEmailDate(to)}`;
  if (from) return `since ${formatEmailDate(from)}`;
  return `through ${formatEmailDate(to!)}`;
}
