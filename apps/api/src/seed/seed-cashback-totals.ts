/**
 * Idempotent: loads the paid-out cashback history that predates this system
 * (Dec 2025 - Sep 2026) into `cashbackMonthlyTotals`, which feeds the
 * Cashback Trend report. Stations are matched by code; re-running overwrites
 * only figures that were themselves seeded (never an automatic or manually
 * corrected one). Run with
 * `npm run cashback-totals:seed --workspace=@loyalty/api`.
 *
 * Dec-Aug come from finance's spreadsheet (all stations except Rodi, which
 * opened in September). September is the reconciled combined payout file
 * (498,898.78): the per-station payout files summed to 497,207.60, and the
 * remaining 1,691.18 is four customers missing from those files plus twelve
 * customers whose amounts were higher in the combined file - assigned to the
 * stations those customers belong to.
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CashbackTrendService, stationLabel } from '../cashback-trend/cashback-trend.service';

/** The deployed project (see .firebaserc / backend-deploy.yml). A local .env can point elsewhere, so the script refuses to write anywhere else. */
const LIVE_PROJECT_ID = 'customer-loyalty-3af1a';

const MONTHS = [
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
];

/** Station code -> amounts aligned with MONTHS; null = station not yet operating that month. */
const HISTORY: Record<string, (number | null)[]> = {
  CBD: [151695, 176173, 145808, 133696, 181980, 193200, 157302, 202472, 209751.6, 184492.04],
  KSM1: [101018, 101350, 74305, 86136, 87569, 85648, 65098, 79173, 79326.8, 54123],
  MBT: [64408, 63728, 67153, 73168, 109843, 146761, 171430, 174346, 178600.2, 143466.58],
  UGJA: [63594, 77365, 73946, 77350, 71611, 60658, 42440, 59097, 68547, 37758.04],
  UGJB: [105020, 111370, 100368, 130929, 141927, 156443, 79674, 94075.4, 100900.2, 73713.12],
  ROD: [null, null, null, null, null, null, null, null, null, 5346],
};

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const projectId = app.get(ConfigService).get<string>('gcpProjectId');
  if (projectId !== LIVE_PROJECT_ID) {
    await app.close();
    throw new Error(
      `Refusing to seed: GCP_PROJECT_ID is "${projectId}", expected "${LIVE_PROJECT_ID}". Set GCP_PROJECT_ID (and credentials for that project) for this run.`,
    );
  }
  console.log(`Seeding Firestore project ${projectId}`);
  const trend = app.get(CashbackTrendService);
  const stations = await trend.listStations();
  const byCode = new Map(stations.map((s) => [s.code, s]));

  let written = 0;
  let skipped = 0;
  for (const [code, amounts] of Object.entries(HISTORY)) {
    const station = byCode.get(code);
    if (!station) throw new Error(`Station with code ${code} not found - run stations:ensure first`);
    for (let i = 0; i < MONTHS.length; i++) {
      const amount = amounts[i];
      const month = MONTHS[i];
      if (month === undefined) continue;
      if (amount === null || amount === undefined) continue;
      const wrote = await trend.upsertTotal(
        { month, stationId: station.id, stationName: stationLabel(station), amount },
        'seed',
      );
      if (wrote) written++;
      else skipped++;
    }
  }
  console.log(`Seeded ${written} monthly totals (${skipped} left alone - already recorded by the system or corrected manually)`);
  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
