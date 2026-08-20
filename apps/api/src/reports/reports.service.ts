import { Injectable } from '@nestjs/common';
import { ReconciliationStatus, SpecialRateStatus, type Sale } from '@loyalty/shared';
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

    const pendingSpecialRatesSnap = await this.firestore
      .collection('specialRateRequests')
      .where('status', '==', SpecialRateStatus.PENDING)
      .count()
      .get();

    let reconQuery = this.firestore.collection('reconciliationDaily').where('date', '==', today) as FirebaseFirestore.Query;
    if (stationId) reconQuery = reconQuery.where('stationId', '==', stationId);
    const reconSnap = await reconQuery.get();
    const needsAttention = reconSnap.docs.filter((d) => {
      const status = d.data().status as ReconciliationStatus;
      return status === ReconciliationStatus.EXCEEDED || status === ReconciliationStatus.NEEDS_REVIEW;
    }).length;

    return {
      month: today.slice(0, 7),
      totalCashbackMonth,
      totalSalesAmountMonth,
      saleCount: sales.length,
      uniqueCustomers,
      pendingSpecialRateRequests: pendingSpecialRatesSnap.data().count,
      reconciliationRecordsNeedingAttention: needsAttention,
    };
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
