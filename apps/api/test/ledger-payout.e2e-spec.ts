import type { INestApplication } from '@nestjs/common';
import { getPermissionsForRole, LedgerStatus, Permission, Role, UserStatus, type MonthlyCashbackLedger } from '@loyalty/shared';
import { CashbackLedgersService } from '../src/cashback-ledgers/cashback-ledgers.service';
import { FirestoreService } from '../src/common/firestore/firestore.service';
import { nowIso } from '../src/common/firestore/helpers';
import type { StaffPrincipal } from '../src/common/types/principal';
import { DisbursementBatchesService } from '../src/disbursement-batches/disbursement-batches.service';
import { LedgerPayoutService } from '../src/disbursement-batches/ledger-payout.service';
import { DisbursementSettingsService } from '../src/settings/disbursement-settings.service';
import { createTestApp } from './utils/test-app';

/**
 * Requires the Firestore emulator (see test/setup-emulator.ts). The
 * approved ledger is seeded directly — the release window would otherwise
 * tie this test to the 1st/2nd of the month.
 */
describe('Ledger payout: combined payment file and mark disbursed (e2e)', () => {
  let app: INestApplication;
  const disburser: StaffPrincipal = {
    kind: 'staff',
    userId: 'disburser-1',
    email: 'disburser@greenwellsenergies.co.ke',
    fullName: 'Disburser Person',
    role: Role.FINANCE_DISBURSER,
    permissions: getPermissionsForRole(Role.FINANCE_DISBURSER),
    status: UserStatus.ACTIVE,
  };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('grants download to the seven roles and mark-disbursed only to Finance Disburser and Super Admin', () => {
    const canDownload = [
      Role.FINANCE_DISBURSER,
      Role.FINANCE_APPROVER,
      Role.EXEC_VIEWER,
      Role.CHAIRMAN,
      Role.ADMIN,
      Role.SUPER_ADMIN,
      Role.AUDIT,
    ];
    for (const role of Object.values(Role)) {
      const perms = getPermissionsForRole(role);
      expect([role, perms.includes(Permission.LEDGERS_EXPORT_PAYMENT_FILE)]).toEqual([role, canDownload.includes(role)]);
      expect([role, perms.includes(Permission.LEDGERS_MARK_DISBURSED)]).toEqual([
        role,
        role === Role.FINANCE_DISBURSER || role === Role.SUPER_ADMIN,
      ]);
    }
  });

  it('builds one combined file, marks the month disbursed once, and carries small balances forward', async () => {
    const firestore = app.get(FirestoreService);
    const ledgers = app.get(CashbackLedgersService);
    const payout = app.get(LedgerPayoutService);
    await app.get(DisbursementSettingsService).update({ minDisbursementAmount: 100 });

    // A far-future month nothing else touches, so reruns stay independent.
    const month = `20${70 + Math.floor(Math.random() * 29)}-0${1 + Math.floor(Math.random() * 8)}`;
    const nextMonth = `${month.slice(0, 5)}0${Number(month.slice(5)) + 1}`;
    await firestore.collection('monthlyCashbackLedgers').doc(nextMonth).delete();
    const now = nowIso();
    const entry = (customerId: string, name: string, phone: string, stationId: string, totalCashback: number) => ({
      customerId,
      customerName: name,
      customerPhone: phone,
      stationId,
      stationName: stationId.toUpperCase(),
      eligibleSalesCount: 1,
      totalCashback,
    });
    const seeded: Omit<MonthlyCashbackLedger, 'id'> = {
      month,
      status: LedgerStatus.SUBMITTED_FOR_APPROVAL,
      entries: [
        entry('c-amina', 'Amina Otieno', '+254711000001', 'stn-a', 80),
        entry('c-amina', 'Amina Otieno', '+254711000001', 'stn-b', 70), // 150 combined -> paid as one row
        entry('c-brian', 'Brian Kip', '+254711000002', 'stn-a', 120),
        entry('c-cate', 'Cate Wairimu', '+254711000003', 'stn-b', 40), // below 100 -> carried forward
      ],
      totalCashback: 310,
      stationReleases: [],
      createdAt: now,
      updatedAt: now,
    };
    await firestore.collection('monthlyCashbackLedgers').doc(month).set(seeded);

    // Not available before approval.
    await expect(payout.paymentFile(month)).rejects.toThrow(/approved/);
    await expect(payout.markDisbursed(month, disburser)).rejects.toThrow(/approved/);

    await firestore.collection('monthlyCashbackLedgers').doc(month).update({ status: LedgerStatus.APPROVED });

    const { text, rows } = await payout.paymentFile(month);
    expect(rows).toEqual([
      { customerId: 'c-amina', customerName: 'Amina Otieno', customerPhone: '+254711000001', amount: 150 },
      { customerId: 'c-brian', customerName: 'Brian Kip', customerPhone: '+254711000002', amount: 120 },
    ]);
    const lines = text.split('\r\n');
    expect(lines[0]).toContain('CUSTOMER LOYALTY CASHBACK - ALL STATIONS');
    expect(lines[3]).toContain('Amina Otieno');
    expect(lines[3]).toContain('254711000001\t150.00 ');
    expect(lines[5]!.endsWith('270.00')).toBe(true);
    expect(text).not.toContain('Cate Wairimu');

    const disbursed = await payout.markDisbursed(month, disburser);
    expect(disbursed.status).toBe(LedgerStatus.DISBURSED);
    expect(disbursed.disbursedByName).toBe('Disburser Person');
    expect(disbursed.payoutRows).toEqual(rows);
    const disbursedByKey = new Map(disbursed.entries.map((e) => [`${e.customerId}:${e.stationId}`, e.disbursedAmount]));
    expect(disbursedByKey.get('c-amina:stn-a')).toBe(80);
    expect(disbursedByKey.get('c-amina:stn-b')).toBe(70);
    expect(disbursedByKey.get('c-brian:stn-a')).toBe(120);
    expect(disbursedByKey.get('c-cate:stn-b')).toBeUndefined();

    const next = await ledgers.findByMonth(nextMonth);
    expect(next.entries.find((e) => e.customerId === 'c-cate')?.carriedForwardAmount).toBe(40);

    // Second click is refused; file is still downloadable with what was paid; no batch can pay it again.
    await expect(payout.markDisbursed(month, disburser)).rejects.toThrow();
    expect((await payout.paymentFile(month)).text).toBe(text);
    await expect(app.get(DisbursementBatchesService).create(month, disburser)).rejects.toThrow(/already marked disbursed/);

    await firestore.collection('monthlyCashbackLedgers').doc(month).delete();
    await firestore.collection('monthlyCashbackLedgers').doc(nextMonth).delete();
  });
});
