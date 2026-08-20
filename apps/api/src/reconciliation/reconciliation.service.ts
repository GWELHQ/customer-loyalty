import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  RECONCILIATION_EXCEEDED_PCT,
  RECONCILIATION_NEAR_LIMIT_PCT,
  ReconciliationStatus,
  type Product,
  type ReconciliationDaily,
} from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import type { StaffPrincipal } from '../common/types/principal';

const COLLECTION = 'reconciliationDaily';

function dailyKey(stationId: string, product: Product, date: string): string {
  return `${stationId}__${product}__${date.slice(0, 10)}`;
}

function computeStatus(totalSales: number, loyaltySales: number): ReconciliationStatus {
  if (totalSales <= 0) return ReconciliationStatus.PENDING;
  const pct = (loyaltySales / totalSales) * 100;
  if (pct >= RECONCILIATION_EXCEEDED_PCT) return ReconciliationStatus.EXCEEDED;
  if (pct >= RECONCILIATION_NEAR_LIMIT_PCT) return ReconciliationStatus.NEAR_LIMIT;
  return ReconciliationStatus.HEALTHY;
}

@Injectable()
export class ReconciliationService {
  constructor(private readonly firestore: FirestoreService) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async ingestDailyTotal(
    input: { stationId: string; product: Product; date: string; totalSales: number },
    actor: StaffPrincipal,
  ): Promise<ReconciliationDaily> {
    const id = dailyKey(input.stationId, input.product, input.date);
    const ref = this.col().doc(id);
    const now = nowIso();

    return this.firestore.instance.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const loyaltySales = snap.exists ? ((snap.data()?.loyaltySales as number) ?? 0) : 0;
      const flaggedSaleIds = snap.exists ? ((snap.data()?.flaggedSaleIds as string[]) ?? []) : [];
      const status = computeStatus(input.totalSales, loyaltySales);

      const doc: Omit<ReconciliationDaily, 'id'> = {
        stationId: input.stationId,
        product: input.product,
        date: input.date.slice(0, 10),
        totalSales: input.totalSales,
        loyaltySales,
        percentage: input.totalSales > 0 ? round2((loyaltySales / input.totalSales) * 100) : 0,
        headroom: round2(input.totalSales - loyaltySales),
        status,
        ingestedByUserId: actor.userId,
        flaggedSaleIds,
        createdAt: snap.exists ? (snap.data()?.createdAt as string) : now,
        updatedAt: now,
      };
      tx.set(ref, doc, { merge: true });
      return { ...doc, id };
    });
  }

  /**
   * Called inside the sale-creation transaction. Returns whether the sale
   * may proceed and, if so, the reconciliation state it should be recorded
   * against. Throws ConflictException only when the day/station/product is
   * already at or over its total-sales ceiling — a new sale would compound
   * an existing violation. A sale that itself crosses the ceiling is still
   * allowed (fuel was already dispensed) but flags the day for review.
   */
  async reserveLoyaltySaleAmount(
    tx: FirebaseFirestore.Transaction,
    params: { stationId: string; product: Product; date: string; amountPaid: number; saleId: string },
  ): Promise<{ status: ReconciliationStatus } | null> {
    const id = dailyKey(params.stationId, params.product, params.date);
    const ref = this.col().doc(id);
    const snap = await tx.get(ref);

    if (!snap.exists) {
      // No total-sales figure ingested yet for this day/station/product —
      // cannot evaluate the rule. Loyalty sales still accrue; the record
      // stays PENDING until totals are ingested.
      const now = nowIso();
      const doc: Omit<ReconciliationDaily, 'id'> = {
        stationId: params.stationId,
        product: params.product,
        date: params.date.slice(0, 10),
        totalSales: 0,
        loyaltySales: params.amountPaid,
        percentage: 0,
        headroom: 0,
        status: ReconciliationStatus.PENDING,
        ingestedByUserId: 'system',
        flaggedSaleIds: [],
        createdAt: now,
        updatedAt: now,
      };
      tx.set(ref, doc);
      return { status: ReconciliationStatus.PENDING };
    }

    const data = snap.data()!;
    const totalSales = data.totalSales as number;
    const currentLoyalty = data.loyaltySales as number;
    const headroomBefore = totalSales - currentLoyalty;

    if (totalSales > 0 && headroomBefore <= 0) {
      throw new ConflictException(
        `Loyalty sales already meet or exceed total recorded sales for this station/product/date (${params.date.slice(0, 10)}). This sale cannot be recorded until reconciliation is reviewed.`,
      );
    }

    const newLoyalty = currentLoyalty + params.amountPaid;
    const status = computeStatus(totalSales, newLoyalty);
    const flaggedSaleIds = (data.flaggedSaleIds as string[]) ?? [];
    if (status === ReconciliationStatus.EXCEEDED || status === ReconciliationStatus.NEEDS_REVIEW) {
      flaggedSaleIds.push(params.saleId);
    }

    tx.update(ref, {
      loyaltySales: newLoyalty,
      percentage: totalSales > 0 ? round2((newLoyalty / totalSales) * 100) : 0,
      headroom: round2(totalSales - newLoyalty),
      status,
      flaggedSaleIds,
      updatedAt: nowIso(),
    });

    return { status };
  }

  async listDaily(filters: { stationId?: string; date?: string }): Promise<ReconciliationDaily[]> {
    let query = this.col().orderBy('date', 'desc') as FirebaseFirestore.Query;
    if (filters.stationId) query = query.where('stationId', '==', filters.stationId);
    if (filters.date) query = query.where('date', '==', filters.date.slice(0, 10));
    const snap = await query.limit(200).get();
    return snap.docs.map((d) => fromDoc<ReconciliationDaily>(d));
  }

  async findById(id: string): Promise<ReconciliationDaily> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Reconciliation record not found');
    return fromDoc<ReconciliationDaily>(snap);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
