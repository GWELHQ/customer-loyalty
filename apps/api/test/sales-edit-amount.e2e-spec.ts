import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Product, SaleApprovalStatus, UserStatus } from '@loyalty/shared';
import { CustomersService } from '../src/customers/customers.service';
import { FirestoreService } from '../src/common/firestore/firestore.service';
import { PricesService } from '../src/prices/prices.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { StationsService } from '../src/stations/stations.service';
import { SalesService } from '../src/sales/sales.service';
import { nairobiDateKey } from '../src/common/time/nairobi';
import { createTestApp } from './utils/test-app';

/**
 * Requires the Firestore emulator (see test/setup-emulator.ts). Exercises
 * the Super Admin "edit sale amount" correction path: the cashback snapshot
 * must be recomputed off the pinned price/rate, and both the customer's
 * balance and the day's reconciliation bucket must move by the delta, not
 * be replaced outright.
 */
describe('Sales edit amount (e2e)', () => {
  let app: INestApplication;
  let stationId: string;
  let customerId: string;
  const superAdmin = {
    kind: 'staff' as const,
    userId: 'super-admin-1',
    email: 'admin@greenwellsenergies.co.ke',
    fullName: 'Super Admin',
    role: 'super_admin' as never,
    permissions: [],
    status: UserStatus.ACTIVE,
  };

  beforeAll(async () => {
    app = await createTestApp();

    const stations = app.get(StationsService);
    const prices = app.get(PricesService);
    const customers = app.get(CustomersService);

    const station = await stations.create({
      name: 'Nakuru 1',
      code: `NAK1-${randomUUID().slice(0, 6)}`,
    });
    stationId = station.id;

    await prices.create(
      {
        stationId,
        product: Product.PMS,
        pricePerLitre: 200,
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
      superAdmin,
    );

    const customer = await customers.create({ fullName: 'Amos Kiptoo', phoneNumber: '0722334455' });
    customerId = customer.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('recomputes the cashback snapshot and applies the delta to the customer balance and reconciliation bucket', async () => {
    const sales = app.get(SalesService);
    const customers = app.get(CustomersService);
    const reconciliation = app.get(ReconciliationService);

    const idempotencyKey = randomUUID();
    const created = await sales.createSale(
      {
        customerPhone: '+254722334455',
        product: Product.PMS,
        amountPaid: 2000, // 10 whole litres @ 200/L -> 20 KES cashback @ default rate
        stationId,
        idempotencyKey,
      },
      superAdmin,
    );
    expect(created.snapshot.wholeLitres).toBe(10);
    expect(created.snapshot.cashbackEarned).toBe(20);
    expect(created.approvalStatus).toBe(SaleApprovalStatus.APPROVED);

    const customerBefore = await customers.findById(customerId);

    const updated = await sales.updateAmount(created.id, 2400, superAdmin); // 12 whole litres -> 24 KES cashback
    expect(updated.amountPaid).toBe(2400);
    expect(updated.snapshot.wholeLitres).toBe(12);
    expect(updated.snapshot.cashbackEarned).toBe(24);
    // Price/rate stay pinned to what was captured at sale time, not re-fetched.
    expect(updated.snapshot.pricePerLitre).toBe(created.snapshot.pricePerLitre);
    expect(updated.snapshot.cashbackRatePerLitre).toBe(created.snapshot.cashbackRatePerLitre);

    const customerAfter = await customers.findById(customerId);
    expect(customerAfter.totalCashbackEarned).toBe(customerBefore.totalCashbackEarned + 4);

    const dailyId = `${stationId}__${Product.PMS}__${nairobiDateKey(updated.saleDate)}`;
    const daily = await reconciliation.findById(dailyId);
    expect(daily.loyaltySales).toBe(2400);
  });

  it('rejects editing a sale that was already rejected', async () => {
    const sales = app.get(SalesService);
    const firestore = app.get(FirestoreService);
    const idempotencyKey = randomUUID();
    const created = await sales.createSale(
      {
        customerPhone: '+254722334455',
        product: Product.PMS,
        amountPaid: 1000,
        stationId,
        idempotencyKey,
      },
      superAdmin,
    );

    // FEATURE_FLAGS.salesApprovals is off, so every sale auto-approves —
    // there's no service-level path to a REJECTED sale to exercise this
    // guard against, so the fixture is set up directly.
    await firestore.collection('sales').doc(created.id).update({ approvalStatus: SaleApprovalStatus.REJECTED });

    await expect(sales.updateAmount(created.id, 1500, superAdmin)).rejects.toThrow(
      'Cannot edit the amount of a rejected sale',
    );
  });
});
