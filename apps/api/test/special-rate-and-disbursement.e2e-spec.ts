import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { LedgerStatus, Product, Role, SpecialRateStatus, UserStatus } from '@loyalty/shared';
import { CashbackLedgersService } from '../src/cashback-ledgers/cashback-ledgers.service';
import { CustomersService } from '../src/customers/customers.service';
import { DisbursementBatchesService } from '../src/disbursement-batches/disbursement-batches.service';
import { PricesService } from '../src/prices/prices.service';
import { SalesService } from '../src/sales/sales.service';
import { SpecialRateRequestsService } from '../src/special-rate-requests/special-rate-requests.service';
import { StationsService } from '../src/stations/stations.service';
import type { StaffPrincipal } from '../src/common/types/principal';
import { createTestApp } from './utils/test-app';

const rtsm: StaffPrincipal = {
  kind: 'staff',
  userId: 'rtsm-1',
  email: 'rtsm@greenwellsenergies.co.ke',
  fullName: 'RTSM Person',
  role: Role.RTSM,
  status: UserStatus.ACTIVE,
};
const chairman: StaffPrincipal = {
  kind: 'staff',
  userId: 'chairman-1',
  email: 'chairman@greenwellsenergies.co.ke',
  fullName: 'Chairman Person',
  role: Role.CHAIRMAN,
  status: UserStatus.ACTIVE,
};
const finance: StaffPrincipal = {
  kind: 'staff',
  userId: 'finance-1',
  email: 'finance@greenwellsenergies.co.ke',
  fullName: 'Finance Person',
  role: Role.FINANCE_APPROVER,
  status: UserStatus.ACTIVE,
};
const admin: StaffPrincipal = {
  kind: 'staff',
  userId: 'admin-1',
  email: 'admin@greenwellsenergies.co.ke',
  fullName: 'Admin Person',
  role: Role.ADMIN,
  status: UserStatus.ACTIVE,
};

describe('Special rate approval -> sale -> ledger -> disbursement (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the full workflow and enforces every state-transition rule along the way', async () => {
    const stations = app.get(StationsService);
    const prices = app.get(PricesService);
    const customers = app.get(CustomersService);
    const specialRates = app.get(SpecialRateRequestsService);
    const sales = app.get(SalesService);
    const ledgers = app.get(CashbackLedgersService);
    const batches = app.get(DisbursementBatchesService);

    const station = await stations.create({
      name: 'Ugunja',
      code: `UGJ-${randomUUID().slice(0, 6)}`,
    });
    await prices.create(
      {
        product: Product.PMS,
        pricePerLitre: 200,
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
      admin,
    );
    const customer = await customers.create({
      fullName: 'Loyal Customer',
      phoneNumber: `07${Math.floor(10000000 + Math.random() * 89999999)}`,
    });

    // RTSM requests a special rate; RTSM cannot approve its own request.
    const req = await specialRates.create(
      {
        customerId: customer.id,
        proposedKesPerLitre: 5,
        effectiveFrom: new Date(Date.now() - 1000).toISOString(),
        reason: 'High-volume fleet customer',
      },
      rtsm,
    );
    expect(req.status).toBe(SpecialRateStatus.PENDING);

    // Admin is explicitly not allowed to decide it (enforced at the route
    // guard in production; the service-level check is defense in depth).
    expect(() => specialRates.assertCanApprove(admin)).toThrow();

    const approved = await specialRates.decide(
      req.id,
      'approved',
      'Approved for FY26 fleet contract',
      chairman,
    );
    expect(approved.status).toBe(SpecialRateStatus.APPROVED);

    // A second decision on an already-decided request is rejected.
    await expect(specialRates.decide(req.id, 'rejected', undefined, chairman)).rejects.toThrow();

    // The sale now earns cashback at the approved special rate, not the default.
    const sale = await sales.createSale(
      {
        customerPhone: customer.phoneNumber,
        product: Product.PMS,
        amountPaid: 2000, // 10 litres @ KSh 200
        stationId: station.id,
        idempotencyKey: randomUUID(),
      },
      admin,
    );
    expect(sale.snapshot.cashbackRatePerLitre).toBe(5);
    expect(sale.snapshot.cashbackEarned).toBe(50); // 10 whole litres * KSh 5

    const month = sale.saleDate.slice(0, 7);
    const ledger = await ledgers.getOrCreate(month);
    expect(ledger.entries.some((e) => e.customerId === customer.id)).toBe(true);

    // A batch cannot be created before the ledger is approved.
    await expect(batches.create(month, finance)).rejects.toThrow();

    await ledgers.submit(month, admin);
    await expect(ledgers.approve(month, finance)).resolves.toBeDefined();

    const batch = await batches.create(month, finance);
    expect(batch.entries.length).toBeGreaterThan(0);

    // Cannot mark processing before confirmation.
    await expect(batches.markProcessing(batch.id)).rejects.toThrow();
    await batches.confirm(batch.id, finance);
    await batches.markProcessing(batch.id);

    const completed = await batches.complete(
      batch.id,
      batch.entries.map((e) => ({
        customerId: e.customerId,
        status: 'paid' as const,
        reference: 'MPESA123',
      })),
    );
    expect(completed.status).toBe('completed');

    const finalLedger = await ledgers.findByMonth(month);
    expect(finalLedger.status).toBe(LedgerStatus.DISBURSED);
  });
});
