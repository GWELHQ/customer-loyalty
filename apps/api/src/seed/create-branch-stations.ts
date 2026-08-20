/**
 * Idempotent: creates any of the given branch stations that don't already
 * exist yet (matched by code), skips ones that do. Safe to run against a
 * real project — run with `npm run stations:ensure --workspace=@loyalty/api`.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StationsService } from '../stations/stations.service';

const BRANCHES = [
  { code: 'KSM1', name: 'Kisumu 1' },
  { code: 'CBD', name: 'Kisumu 2' },
  { code: 'UGJA', name: 'Ugunja A' },
  { code: 'UGJB', name: 'Ugunja B' },
  { code: 'MBT', name: 'Mbita' },
  { code: 'ROD', name: 'Rodi' },
];

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const stationsSvc = app.get(StationsService);

  const existing = await stationsSvc.list();
  const existingCodes = new Set(existing.map((s) => s.code));

  for (const branch of BRANCHES) {
    if (existingCodes.has(branch.code)) {
      console.log(`Skipping ${branch.code} — already exists`);
      continue;
    }
    const created = await stationsSvc.create(branch);
    console.log(`Created ${created.code} — ${created.name}`);
  }

  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
