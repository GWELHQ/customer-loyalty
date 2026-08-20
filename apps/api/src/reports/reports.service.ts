import { Injectable } from '@nestjs/common';
import { Product, ReconciliationStatus, SpecialRateStatus, type Sale, type Station } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc } from '../common/firestore/helpers';

@Injectable()
export class ReportsService {
  constructor(private readonly firestore: FirestoreService) {}

  async dashboard(stationId?: string) {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;

    let salesQuery = this.firestore
      .collection('sales')
      .where('saleDate', '>=', `${monthStart}T00:00:00.000Z`) as FirebaseFirestore.Query;
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

  /** Last 7 days of loyalty sales amount, split by product — a fixed rolling window, independent of the calendar month boundary the rest of `dashboard()` uses. */
  private async salesTrend(stationId?: string): Promise<Array<{ date: string; label: string; pms: number; ago: number }>> {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    let query = this.firestore.collection('sales').where('saleDate', '>=', start.toISOString()) as FirebaseFirestore.Query;
    if (stationId) query = query.where('stationId', '==', stationId);
    const snap = await query.get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));

    const byDay = new Map<string, { pms: number; ago: number }>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      byDay.set(d.toISOString().slice(0, 10), { pms: 0, ago: 0 });
    }
    for (const sale of sales) {
      const day = sale.saleDate.slice(0, 10);
      const bucket = byDay.get(day);
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

  /** Today's loyalty sales amount per station — only meaningful for an unscoped (all-stations) view. */
  private async todayStationTotals(
    monthToDateSales: Sale[],
    today: string,
  ): Promise<Array<{ stationId: string; name: string; value: number }>> {
    const stationsSnap = await this.firestore.collection('stations').orderBy('name').get();
    const stations = stationsSnap.docs.map((d) => fromDoc<Station>(d));

    const byStation = new Map<string, number>();
    for (const sale of monthToDateSales) {
      if (!sale.saleDate.startsWith(today)) continue;
      byStation.set(sale.stationId, (byStation.get(sale.stationId) ?? 0) + sale.amountPaid);
    }

    return stations.map((s) => ({ stationId: s.id, name: s.name, value: round2(byStation.get(s.id) ?? 0) }));
  }

  async salesReport(filters: { stationId?: string; from?: string; to?: string }) {
    let query = this.firestore.collection('sales').orderBy('saleDate', 'desc') as FirebaseFirestore.Query;
    if (filters.stationId) query = query.where('stationId', '==', filters.stationId);
    if (filters.from) query = query.where('saleDate', '>=', filters.from);
    if (filters.to) query = query.where('saleDate', '<=', filters.to);
    const snap = await query.limit(1000).get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));

    const byProduct: Record<string, { count: number; amount: number; cashback: number }> = {};
    for (const sale of sales) {
      const bucket = (byProduct[sale.product] ??= { count: 0, amount: 0, cashback: 0 });
      bucket.count += 1;
      bucket.amount = round2(bucket.amount + sale.amountPaid);
      bucket.cashback = round2(bucket.cashback + sale.snapshot.cashbackEarned);
    }

    return { sales, byProduct };
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
