import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Product, ReconciliationStatus, Role } from '@loyalty/shared';
import { CustomersService } from '../src/customers/customers.service';
import { PricesService } from '../src/prices/prices.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { SalesService } from '../src/sales/sales.service';
import { StationsService } from '../src/stations/stations.service';
import type { StaffPrincipal } from '../src/common/types/principal';
import { createTestApp } from './utils/test-app';

const admin: StaffPrincipal = {
  kind: 'staff',
  userId: 'admin-recon',
  email: 'admin@greenwellsenergies.co.ke',
  fullName: 'Admin Person',
  role: Role.ADMIN,
};

describe('Reconciliation blocking rule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('flags a sale that pushes loyalty sales over total sales, then blocks the next one outright', async () => {
    const stations = app.get(StationsService);
    const prices = app.get(PricesService);
    const customers = app.get(CustomersService);
    const sales = app.get(SalesService);
    const reconciliation = app.get(ReconciliationService);

    const station = await stations.create({
      name: 'Mbita',
      code: `MBT-${randomUUID().slice(0, 6)}`,
    });
    await prices.create(
      {
        product: Product.AGO,
        pricePerLitre: 100,
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
      admin,
    );
    const customer = await customers.create({
      fullName: 'Frequent Buyer',
      phoneNumber: `07${Math.floor(10000000 + Math.random() * 89999999)}`,
    });
    const today = new Date().toISOString();

    // Total recorded sales for the day/station/product: KSh 1,000.
    await reconciliation.ingestDailyTotal(
      { stationId: station.id, product: Product.AGO, date: today, totalSales: 1000 },
      admin,
    );

    // First loyalty sale (KSh 900) stays within headroom — healthy/near-limit, not blocked.
    const first = await sales.createSale(
      {
        customerPhone: customer.phoneNumber,
        product: Product.AGO,
        amountPaid: 900,
        stationId: station.id,
        saleDate: today,
        idempotencyKey: randomUUID(),
      },
      admin,
    );
    expect(first).toBeDefined();

    // Second loyalty sale (KSh 200) crosses the ceiling (900+200 > 1000) —
    // still allowed (fuel already dispensed) but flags the day for review.
    const second = await sales.createSale(
      {
        customerPhone: customer.phoneNumber,
        product: Product.AGO,
        amountPaid: 200,
        stationId: station.id,
        saleDate: today,
        idempotencyKey: randomUUID(),
      },
      admin,
    );
    expect(second).toBeDefined();

    const daily = await reconciliation.listDaily({ stationId: station.id, date: today });
    const record = daily.find((d) => d.product === Product.AGO)!;
    expect(
      record.status === ReconciliationStatus.EXCEEDED ||
        record.status === ReconciliationStatus.NEAR_LIMIT,
    ).toBe(true);

    // A third sale now that headroom is already at or below zero is blocked outright.
    await expect(
      sales.createSale(
        {
          customerPhone: customer.phoneNumber,
          product: Product.AGO,
          amountPaid: 50,
          stationId: station.id,
          saleDate: today,
          idempotencyKey: randomUUID(),
        },
        admin,
      ),
    ).rejects.toThrow();
  });
});
