import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Product, UserStatus } from '@loyalty/shared';
import { CustomersService } from '../src/customers/customers.service';
import { PricesService } from '../src/prices/prices.service';
import { StationsService } from '../src/stations/stations.service';
import { SalesService } from '../src/sales/sales.service';
import { createTestApp } from './utils/test-app';

/**
 * Requires the Firestore emulator (see test/setup-emulator.ts). Exercises
 * the actual transactional idempotency guarantee: sale docs are keyed by
 * idempotencyKey, so retrying the exact same client-generated key can never
 * create a duplicate — this is the core guarantee offline Android sync
 * depends on.
 */
describe('Sales idempotency (e2e)', () => {
  let app: INestApplication;
  let stationId: string;

  beforeAll(async () => {
    app = await createTestApp();

    const stations = app.get(StationsService);
    const prices = app.get(PricesService);
    const customers = app.get(CustomersService);

    const station = await stations.create({
      name: 'Kisumu 1',
      code: `KIS1-${randomUUID().slice(0, 6)}`,
    });
    stationId = station.id;

    await prices.create(
      {
        stationId,
        product: Product.PMS,
        pricePerLitre: 200,
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
      {
        kind: 'staff',
        userId: 'seed',
        email: 'seed@greenwellsenergies.co.ke',
        fullName: 'Seed',
        role: 'admin' as never,
        permissions: [],
        status: UserStatus.ACTIVE,
      },
    );

    await customers.create({ fullName: 'Jane Doe', phoneNumber: '0712345678' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('creating a sale twice with the same idempotencyKey returns the same sale, not a duplicate', async () => {
    const sales = app.get(SalesService);
    const attendant = {
      kind: 'attendant' as const,
      attendantId: 'attendant-1',
      employeeId: 'KIS1-001',
      fullName: 'Peter Otieno',
      role: 'attendant' as never,
      assignedStationId: stationId,
    };

    const idempotencyKey = randomUUID();
    const params = {
      customerPhone: '+254712345678',
      product: Product.PMS,
      amountPaid: 2000,
      stationId,
      idempotencyKey,
      clientLocalId: 'local-1',
    };

    const first = await sales.createSale(params, attendant);
    const second = await sales.createSale(params, attendant);

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('bulk sync reports already_processed for a retried record instead of creating a duplicate', async () => {
    const sales = app.get(SalesService);
    const attendant = {
      kind: 'attendant' as const,
      attendantId: 'attendant-2',
      employeeId: 'KIS1-002',
      fullName: 'Mary Achieng',
      role: 'attendant' as never,
      assignedStationId: stationId,
    };

    const idempotencyKey = randomUUID();
    const params = {
      customerPhone: '+254712345678',
      product: Product.PMS,
      amountPaid: 1000,
      stationId,
      idempotencyKey,
      clientLocalId: 'local-2',
    };

    const firstOutcome = await sales.syncOne(params, attendant);
    expect(firstOutcome.result).toBe('accepted');

    const retryOutcome = await sales.syncOne(params, attendant);
    expect(retryOutcome.result).toBe('already_processed');
    expect(retryOutcome.saleId).toBe(firstOutcome.saleId);
  });
});
