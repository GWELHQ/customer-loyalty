import { Injectable, Logger } from '@nestjs/common';
import { FraudFlagSeverity, FraudFlagType, type Sale } from '@loyalty/shared';
import { CustomersService } from '../customers/customers.service';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc } from '../common/firestore/helpers';
import { nairobiDateKey } from '../common/time/nairobi';
import { ShiftsService } from '../shifts/shifts.service';
import { FraudFlagsService, type CreateFraudFlagInput } from './fraud-flags.service';

const SALES_COLLECTION = 'sales';
const SCAN_WINDOW_DAYS = 30;
const CONCENTRATION_WINDOW_DAYS = 30;
const BURST_WINDOW_DAYS = 7;
const OUTLIER_WINDOW_DAYS = 7;
const HIGH_FREQUENCY_WINDOW_HOURS = 24;
const HIGH_FREQUENCY_MIN_GAP_MINUTES = 45;
const NEW_CUSTOMER_WINDOW_DAYS = 14;

/**
 * Flags irregular fueling activity. Real-time checks run inline (cheap,
 * single-customer queries); batch checks run once nightly via
 * POST /jobs/fraud-scan and need a broader window of sales to compute
 * baselines/outliers, so they're grouped into one bulk fetch instead of
 * many per-customer queries.
 */
@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger('FraudDetectionService');

  constructor(
    private readonly firestore: FirestoreService,
    private readonly flags: FraudFlagsService,
    private readonly customers: CustomersService,
    private readonly shifts: ShiftsService,
  ) {}

  private salesCol() {
    return this.firestore.collection(SALES_COLLECTION);
  }

  // ---------------------------------------------------------------------
  // Real-time checks — called from SalesService.createSale after the sale
  // is written. Never throws: a detection failure must never fail the sale.
  // ---------------------------------------------------------------------
  async runRealtimeChecks(sale: Sale): Promise<void> {
    try {
      await Promise.all([
        this.checkRepeatedExactLitres(sale),
        this.checkLicensePlateMismatch(sale),
        this.checkHighFrequencyRefuel(sale),
        this.checkAttendantOutsideShift(sale),
      ]);
    } catch (err) {
      this.logger.error(`Real-time fraud check failed for sale ${sale.id}`, err instanceof Error ? err.stack : err);
    }
  }

  private async checkRepeatedExactLitres(sale: Sale): Promise<void> {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const snap = await this.salesCol()
      .where('customerId', '==', sale.customerId)
      .where('saleDate', '>=', since)
      .get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));
    const sameLitres = sales.filter((s) => s.snapshot.wholeLitres === sale.snapshot.wholeLitres);
    if (sameLitres.length < 4) return;

    if (await this.flags.hasOpenFlag(FraudFlagType.REPEATED_EXACT_LITRES, { customerId: sale.customerId })) return;

    await this.createFlag({
      type: FraudFlagType.REPEATED_EXACT_LITRES,
      severity: sameLitres.length >= 8 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
      customerId: sale.customerId,
      customerNameAtFlag: await this.customerName(sale.customerId),
      relatedSaleIds: sameLitres.map((s) => s.id),
      detectionMode: 'realtime',
      evidence: {
        wholeLitres: sale.snapshot.wholeLitres,
        occurrences: sameLitres.length,
        windowDays: 90,
      },
    });
  }

  private async checkLicensePlateMismatch(sale: Sale): Promise<void> {
    const check = sale.licensePlateCheck;
    if (!check || check.matched) return;

    if (await this.flags.hasOpenFlag(FraudFlagType.LICENSE_PLATE_MISMATCH, { customerId: sale.customerId })) return;

    const customer = await this.customers.findById(sale.customerId).catch(() => null);

    await this.createFlag({
      type: FraudFlagType.LICENSE_PLATE_MISMATCH,
      severity: FraudFlagSeverity.MEDIUM,
      customerId: sale.customerId,
      customerNameAtFlag: customer?.fullName,
      stationId: sale.stationId,
      stationNameAtFlag: sale.stationNameAtSale,
      attendantId: sale.attendantId,
      attendantNameAtFlag: sale.attendantNameAtSale,
      relatedSaleIds: [sale.id],
      detectionMode: 'realtime',
      evidence: {
        plateCheckId: check.plateCheckId,
        detectedPlateNumber: check.detectedPlateNumber,
        customerLicensePlateNumbers: customer?.licensePlateNumbers ?? null,
      },
    });
  }

  private async checkHighFrequencyRefuel(sale: Sale): Promise<void> {
    const since = new Date(Date.now() - HIGH_FREQUENCY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const snap = await this.salesCol()
      .where('customerId', '==', sale.customerId)
      .where('saleDate', '>=', since)
      .get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));
    if (sales.length < 2) return;

    const sorted = sales.sort((a, b) => a.saleDate.localeCompare(b.saleDate));
    const closePairs: Sale[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      const gapMinutes = (new Date(curr.saleDate).getTime() - new Date(prev.saleDate).getTime()) / 60_000;
      if (gapMinutes < HIGH_FREQUENCY_MIN_GAP_MINUTES) {
        if (!closePairs.includes(prev)) closePairs.push(prev);
        closePairs.push(curr);
      }
    }
    if (closePairs.length < 2) return;

    if (await this.flags.hasOpenFlag(FraudFlagType.HIGH_FREQUENCY_REFUEL, { customerId: sale.customerId })) return;

    await this.createFlag({
      type: FraudFlagType.HIGH_FREQUENCY_REFUEL,
      severity: closePairs.length >= 4 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
      customerId: sale.customerId,
      customerNameAtFlag: await this.customerName(sale.customerId),
      relatedSaleIds: closePairs.map((s) => s.id),
      detectionMode: 'realtime',
      evidence: {
        windowHours: HIGH_FREQUENCY_WINDOW_HOURS,
        minGapMinutes: HIGH_FREQUENCY_MIN_GAP_MINUTES,
        flaggedSaleCount: closePairs.length,
      },
    });
  }

  /**
   * Flags a sale made by an attendant who isn't on the recorded shift
   * roster for that station/date/shift. Skips silently (no flag) when no
   * roster was ever recorded — a supervisor not having filled it in yet
   * isn't the attendant's fault, and shouldn't produce false positives.
   */
  private async checkAttendantOutsideShift(sale: Sale): Promise<void> {
    const roster = await this.shifts.findRosterForSale(sale.stationId, sale.saleDate);
    if (!roster) return;
    if (roster.attendantIds.includes(sale.attendantId)) return;

    if (await this.flags.hasOpenFlag(FraudFlagType.ATTENDANT_OUTSIDE_SHIFT, { attendantId: sale.attendantId })) return;

    await this.createFlag({
      type: FraudFlagType.ATTENDANT_OUTSIDE_SHIFT,
      severity: FraudFlagSeverity.MEDIUM,
      stationId: sale.stationId,
      stationNameAtFlag: sale.stationNameAtSale,
      attendantId: sale.attendantId,
      attendantNameAtFlag: sale.attendantNameAtSale,
      relatedSaleIds: [sale.id],
      detectionMode: 'realtime',
      evidence: {
        shift: roster.shift,
        rosterDate: roster.date,
        rosteredAttendantIds: roster.attendantIds,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Batch checks — invoked nightly via POST /jobs/fraud-scan.
  // ---------------------------------------------------------------------
  async runScan(): Promise<{ flagsCreated: number; checksRun: string[] }> {
    const windowStart = new Date(Date.now() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const snap = await this.salesCol().where('saleDate', '>=', windowStart).get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));

    const yesterdayKey = nairobiDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const sevenDaysAgo = new Date(Date.now() - BURST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    let flagsCreated = 0;
    flagsCreated += await this.scanVolumeSpikes(sales, yesterdayKey);
    flagsCreated += await this.scanMultiLocation(sales, yesterdayKey);
    flagsCreated += await this.scanAttendantCustomerConcentration(sales);
    flagsCreated += await this.scanCustomerMultiAttendantBurst(sales, sevenDaysAgo);
    flagsCreated += await this.scanAttendantVolumeOutliers(sales, sevenDaysAgo);
    flagsCreated += await this.scanAdminManualBurst(sales, sevenDaysAgo);
    flagsCreated += await this.scanNewCustomerHighVolume(sales);

    return {
      flagsCreated,
      checksRun: [
        FraudFlagType.VOLUME_SPIKE_VS_BASELINE,
        FraudFlagType.MULTI_LOCATION_SAME_DAY,
        FraudFlagType.ATTENDANT_CUSTOMER_CONCENTRATION,
        FraudFlagType.CUSTOMER_MULTI_ATTENDANT_BURST,
        FraudFlagType.ATTENDANT_VOLUME_OUTLIER,
        FraudFlagType.ADMIN_MANUAL_BURST,
        FraudFlagType.NEW_CUSTOMER_HIGH_VOLUME,
      ],
    };
  }

  private async scanVolumeSpikes(sales: Sale[], yesterdayKey: string): Promise<number> {
    const byCustomer = groupBy(sales, (s) => s.customerId);
    let created = 0;

    for (const [customerId, customerSales] of byCustomer) {
      const dailyLitres = new Map<string, number>();
      for (const s of customerSales) {
        const key = nairobiDateKey(s.saleDate);
        dailyLitres.set(key, (dailyLitres.get(key) ?? 0) + s.snapshot.litres);
      }
      const yesterdayLitres = dailyLitres.get(yesterdayKey);
      if (yesterdayLitres == null) continue;

      const otherDays = [...dailyLitres.entries()].filter(([key]) => key !== yesterdayKey).map(([, v]) => v);
      if (otherDays.length < 5) continue;

      const { avg, stddev } = meanAndStdDev(otherDays);
      const threshold = Math.max(avg * 3, avg + 2 * stddev);
      if (yesterdayLitres <= threshold || avg === 0) continue;

      if (await this.flags.hasOpenFlag(FraudFlagType.VOLUME_SPIKE_VS_BASELINE, { customerId })) continue;

      const relatedSaleIds = customerSales.filter((s) => nairobiDateKey(s.saleDate) === yesterdayKey).map((s) => s.id);
      created += await this.createFlag({
        type: FraudFlagType.VOLUME_SPIKE_VS_BASELINE,
        severity: yesterdayLitres > avg * 5 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
        customerId,
        customerNameAtFlag: await this.customerName(customerId),
        relatedSaleIds,
        periodStart: yesterdayKey,
        periodEnd: yesterdayKey,
        detectionMode: 'batch',
        evidence: {
          baselineAvgLitres: round2(avg),
          baselineStdDevLitres: round2(stddev),
          actualLitres: round2(yesterdayLitres),
          sampleDays: otherDays.length,
        },
      }) ? 1 : 0;
    }
    return created;
  }

  private async scanMultiLocation(sales: Sale[], yesterdayKey: string): Promise<number> {
    const yesterdaySales = sales.filter((s) => nairobiDateKey(s.saleDate) === yesterdayKey);
    const byCustomer = groupBy(yesterdaySales, (s) => s.customerId);
    let created = 0;

    for (const [customerId, customerSales] of byCustomer) {
      const stationIds = new Set(customerSales.map((s) => s.stationId));
      if (stationIds.size < 2) continue;
      if (await this.flags.hasOpenFlag(FraudFlagType.MULTI_LOCATION_SAME_DAY, { customerId })) continue;

      created += await this.createFlag({
        type: FraudFlagType.MULTI_LOCATION_SAME_DAY,
        severity: stationIds.size >= 3 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
        customerId,
        customerNameAtFlag: await this.customerName(customerId),
        relatedSaleIds: customerSales.map((s) => s.id),
        periodStart: yesterdayKey,
        periodEnd: yesterdayKey,
        detectionMode: 'batch',
        evidence: {
          distinctStations: stationIds.size,
          stationNames: [...new Set(customerSales.map((s) => s.stationNameAtSale))],
        },
      }) ? 1 : 0;
    }
    return created;
  }

  private async scanAttendantCustomerConcentration(sales: Sale[]): Promise<number> {
    const byCustomer = groupBy(sales, (s) => s.customerId);
    let created = 0;

    for (const [customerId, customerSales] of byCustomer) {
      if (customerSales.length < 5) continue;
      const byAttendant = groupBy(customerSales, (s) => s.attendantId);
      const [topAttendantId, topSales] = [...byAttendant.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
      const share = topSales.length / customerSales.length;
      if (share <= 0.8) continue;
      if (await this.flags.hasOpenFlag(FraudFlagType.ATTENDANT_CUSTOMER_CONCENTRATION, { customerId })) continue;

      created += await this.createFlag({
        type: FraudFlagType.ATTENDANT_CUSTOMER_CONCENTRATION,
        severity: share >= 0.95 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
        customerId,
        customerNameAtFlag: await this.customerName(customerId),
        attendantId: topAttendantId,
        attendantNameAtFlag: topSales[0]!.attendantNameAtSale,
        relatedSaleIds: topSales.map((s: Sale) => s.id),
        detectionMode: 'batch',
        evidence: {
          windowDays: CONCENTRATION_WINDOW_DAYS,
          totalSales: customerSales.length,
          topAttendantSales: topSales.length,
          share: round2(share),
        },
      }) ? 1 : 0;
    }
    return created;
  }

  private async scanCustomerMultiAttendantBurst(sales: Sale[], sevenDaysAgo: string): Promise<number> {
    const recent = sales.filter((s) => s.saleDate >= sevenDaysAgo);
    const byCustomer = groupBy(recent, (s) => s.customerId);
    let created = 0;

    for (const [customerId, customerSales] of byCustomer) {
      const attendantIds = new Set(customerSales.map((s) => s.attendantId));
      if (attendantIds.size < 4 || customerSales.length < 4) continue;
      if (await this.flags.hasOpenFlag(FraudFlagType.CUSTOMER_MULTI_ATTENDANT_BURST, { customerId })) continue;

      created += await this.createFlag({
        type: FraudFlagType.CUSTOMER_MULTI_ATTENDANT_BURST,
        severity: attendantIds.size >= 6 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
        customerId,
        customerNameAtFlag: await this.customerName(customerId),
        relatedSaleIds: customerSales.map((s) => s.id),
        periodStart: sevenDaysAgo,
        periodEnd: new Date().toISOString(),
        detectionMode: 'batch',
        evidence: {
          windowDays: BURST_WINDOW_DAYS,
          distinctAttendants: attendantIds.size,
          saleCount: customerSales.length,
        },
      }) ? 1 : 0;
    }
    return created;
  }

  private async scanAttendantVolumeOutliers(sales: Sale[], sevenDaysAgo: string): Promise<number> {
    const recent = sales.filter((s) => s.saleDate >= sevenDaysAgo);
    const byStation = groupBy(recent, (s) => s.stationId);
    let created = 0;

    for (const [, stationSales] of byStation) {
      const byAttendant = groupBy(stationSales, (s) => s.attendantId);
      if (byAttendant.size < 3) continue;

      const totals = [...byAttendant.entries()].map(([attendantId, attendantSales]) => ({
        attendantId,
        attendantName: attendantSales[0]!.attendantNameAtSale,
        stationId: attendantSales[0]!.stationId,
        stationName: attendantSales[0]!.stationNameAtSale,
        litres: attendantSales.reduce((sum, s) => sum + s.snapshot.litres, 0),
        saleIds: attendantSales.map((s) => s.id),
      }));
      const { avg, stddev } = meanAndStdDev(totals.map((t) => t.litres));
      const threshold = avg + 2.5 * stddev;
      if (stddev === 0) continue;

      for (const t of totals) {
        if (t.litres <= threshold) continue;
        if (await this.flags.hasOpenFlag(FraudFlagType.ATTENDANT_VOLUME_OUTLIER, { attendantId: t.attendantId })) continue;

        created += await this.createFlag({
          type: FraudFlagType.ATTENDANT_VOLUME_OUTLIER,
          severity: t.litres > avg + 4 * stddev ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
          attendantId: t.attendantId,
          attendantNameAtFlag: t.attendantName,
          stationId: t.stationId,
          stationNameAtFlag: t.stationName,
          relatedSaleIds: t.saleIds,
          periodStart: sevenDaysAgo,
          periodEnd: new Date().toISOString(),
          detectionMode: 'batch',
          evidence: {
            windowDays: OUTLIER_WINDOW_DAYS,
            attendantLitres: round2(t.litres),
            stationAvgLitres: round2(avg),
            stationStdDevLitres: round2(stddev),
            peerCount: totals.length,
          },
        }) ? 1 : 0;
      }
    }
    return created;
  }

  private async scanAdminManualBurst(sales: Sale[], sevenDaysAgo: string): Promise<number> {
    const manual = sales.filter((s) => s.source === 'admin_manual');
    const byAttendant = groupBy(manual, (s) => s.attendantId);
    let created = 0;

    for (const [attendantId, attendantSales] of byAttendant) {
      const recent = attendantSales.filter((s) => s.saleDate >= sevenDaysAgo);
      if (recent.length < 5) continue;
      const baselinePerWeek = (attendantSales.length / SCAN_WINDOW_DAYS) * BURST_WINDOW_DAYS;
      if (baselinePerWeek === 0 || recent.length <= baselinePerWeek * 3) continue;
      if (await this.flags.hasOpenFlag(FraudFlagType.ADMIN_MANUAL_BURST, { attendantId })) continue;

      created += await this.createFlag({
        type: FraudFlagType.ADMIN_MANUAL_BURST,
        severity: recent.length > baselinePerWeek * 5 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
        attendantId,
        attendantNameAtFlag: recent[0]!.attendantNameAtSale,
        relatedSaleIds: recent.map((s) => s.id),
        periodStart: sevenDaysAgo,
        periodEnd: new Date().toISOString(),
        detectionMode: 'batch',
        evidence: {
          windowDays: BURST_WINDOW_DAYS,
          recentManualSales: recent.length,
          ownBaselinePerWeek: round2(baselinePerWeek),
        },
      }) ? 1 : 0;
    }
    return created;
  }

  private async scanNewCustomerHighVolume(sales: Sale[]): Promise<number> {
    const newCustomerCutoff = new Date(Date.now() - NEW_CUSTOMER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const newCustomersSnap = await this.customers.col().where('createdAt', '>=', newCustomerCutoff).get();
    const newCustomers = newCustomersSnap.docs.map((d) => fromDoc<{ id: string; createdAt: string }>(d));
    if (newCustomers.length < 3) return 0;

    const firstSaleByCustomer = new Map<string, Sale>();
    for (const sale of [...sales].sort((a, b) => a.saleDate.localeCompare(b.saleDate))) {
      if (!firstSaleByCustomer.has(sale.customerId)) firstSaleByCustomer.set(sale.customerId, sale);
    }

    const firstSaleLitres = newCustomers
      .map((c) => firstSaleByCustomer.get(c.id))
      .filter((s): s is Sale => s != null)
      .map((s) => s.snapshot.litres);
    if (firstSaleLitres.length < 3) return 0;
    const { avg } = meanAndStdDev(firstSaleLitres);
    if (avg === 0) return 0;

    let created = 0;
    for (const c of newCustomers) {
      const firstSale = firstSaleByCustomer.get(c.id);
      if (!firstSale || firstSale.snapshot.litres <= avg * 2) continue;
      if (await this.flags.hasOpenFlag(FraudFlagType.NEW_CUSTOMER_HIGH_VOLUME, { customerId: c.id })) continue;

      created += await this.createFlag({
        type: FraudFlagType.NEW_CUSTOMER_HIGH_VOLUME,
        severity: firstSale.snapshot.litres > avg * 4 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
        customerId: c.id,
        customerNameAtFlag: await this.customerName(c.id),
        relatedSaleIds: [firstSale.id],
        detectionMode: 'batch',
        evidence: {
          firstSaleLitres: round2(firstSale.snapshot.litres),
          newCustomerPopulationAvgLitres: round2(avg),
          populationSize: firstSaleLitres.length,
        },
      }) ? 1 : 0;
    }
    return created;
  }

  private async createFlag(input: CreateFraudFlagInput): Promise<boolean> {
    await this.flags.create(input);
    return true;
  }

  private async customerName(customerId: string): Promise<string | undefined> {
    try {
      const customer = await this.customers.findById(customerId);
      return customer.fullName;
    } catch {
      return undefined;
    }
  }
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function meanAndStdDev(values: number[]): { avg: number; stddev: number } {
  if (values.length === 0) return { avg: 0, stddev: 0 };
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return { avg, stddev: Math.sqrt(variance) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
