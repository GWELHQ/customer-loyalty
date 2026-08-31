/**
 * Seeds demo/local data: stations, one staff user per role, a couple of
 * attendants, current PMS/AGO prices, and a handful of customers. Run with
 * `npm run seed --workspace=@loyalty/api` against the Firestore emulator or
 * a scratch dev project — never against production.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Role, UserStatus } from '@loyalty/shared';
import { AppModule } from '../app.module';
import { AttendantsService } from '../attendants/attendants.service';
import { CustomersService } from '../customers/customers.service';
import { PricesService } from '../prices/prices.service';
import { StationsService } from '../stations/stations.service';
import { UsersService } from '../users/users.service';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const stationsSvc = app.get(StationsService);
  const usersSvc = app.get(UsersService);
  const attendantsSvc = app.get(AttendantsService);
  const pricesSvc = app.get(PricesService);
  const customersSvc = app.get(CustomersService);

  console.log('Seeding stations...');
  const stationDefs = [
    { name: 'Kisumu 1', code: 'KIS1' },
    { name: 'Kisumu 2', code: 'KIS2' },
    { name: 'Ugunja', code: 'UGJ' },
    { name: 'Mbita', code: 'MBT' },
  ];
  const stations: Record<string, string> = {};
  for (const s of stationDefs) {
    const created = await stationsSvc.create(s);
    stations[s.code] = created.id;
  }

  console.log('Seeding staff users (Microsoft login roles)...');
  const admin = await usersSvc.create({
    fullName: 'Amina Wanjiru',
    email: 'a.wanjiru@greenwellsenergies.co.ke',
    role: Role.ADMIN,
  });
  await usersSvc.setStatus(admin.id, UserStatus.ACTIVE);

  const chairman = await usersSvc.create({
    fullName: 'James Otieno',
    email: 'j.otieno@greenwellsenergies.co.ke',
    role: Role.CHAIRMAN,
  });
  await usersSvc.setStatus(chairman.id, UserStatus.ACTIVE);

  const financeApprover = await usersSvc.create({
    fullName: 'Grace Mwangi',
    email: 'g.mwangi@greenwellsenergies.co.ke',
    role: Role.FINANCE_APPROVER,
  });
  await usersSvc.setStatus(financeApprover.id, UserStatus.ACTIVE);

  const financeDisburser = await usersSvc.create({
    fullName: 'Peter Njoroge',
    email: 'p.njoroge@greenwellsenergies.co.ke',
    role: Role.FINANCE_DISBURSER,
  });
  await usersSvc.setStatus(financeDisburser.id, UserStatus.ACTIVE);

  const rtsm = await usersSvc.create({
    fullName: 'Brian Kiplagat',
    email: 'b.kiplagat@greenwellsenergies.co.ke',
    role: Role.RTSM,
  });
  await usersSvc.setStatus(rtsm.id, UserStatus.ACTIVE);

  const supervisor = await usersSvc.create({
    fullName: 'Susan Adhiambo',
    email: 's.adhiambo@greenwellsenergies.co.ke',
    role: Role.STATION_SUPERVISOR,
    assignedStationId: stations.KIS1!,
  });
  await usersSvc.setStatus(supervisor.id, UserStatus.ACTIVE);

  console.log('Seeding attendants (PIN login)...');
  await attendantsSvc.create({
    fullName: 'Peter Omondi',
    employeeId: 'KIS1-001',
    assignedStationId: stations.KIS1!,
    pin: '1234',
  });
  await attendantsSvc.create({
    fullName: 'Mary Achieng',
    employeeId: 'KIS2-001',
    assignedStationId: stations.KIS2!,
    pin: '1234',
  });

  console.log('Seeding current prices (per station)...');
  const priceActor = {
    kind: 'staff' as const,
    userId: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    role: Role.ADMIN,
    status: UserStatus.ACTIVE,
  };
  for (const stationId of [stations.KIS1!, stations.KIS2!]) {
    await pricesSvc.create(
      {
        stationId,
        product: 'PMS' as never,
        pricePerLitre: 194.5,
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
      priceActor,
    );
    await pricesSvc.create(
      {
        stationId,
        product: 'AGO' as never,
        pricePerLitre: 223.08,
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
      priceActor,
    );
  }

  console.log('Seeding customers...');
  await customersSvc.create({
    fullName: 'Alice Nyambura',
    phoneNumber: '0712345678',
    homeStationId: stations.KIS1,
  });
  await customersSvc.create({
    fullName: 'David Kiplangat',
    phoneNumber: '0722345678',
    homeStationId: stations.MBT,
  });

  console.log('Seed complete.');
  await app.close();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
