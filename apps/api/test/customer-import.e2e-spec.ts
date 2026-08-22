import type { INestApplication } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ImportRowResult, UserStatus } from '@loyalty/shared';
import { CustomerImportsService } from '../src/customers/customer-imports.service';
import { CustomersService } from '../src/customers/customers.service';
import type { StaffPrincipal } from '../src/common/types/principal';
import { createTestApp } from './utils/test-app';

const admin: StaffPrincipal = {
  kind: 'staff',
  userId: 'admin-import',
  email: 'admin@greenwellsenergies.co.ke',
  fullName: 'Admin Person',
  role: 'admin' as never,
  status: UserStatus.ACTIVE,
};

function buildWorkbookBuffer(rows: Record<string, string>[]): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Customers');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('Customer Excel import (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('previews rows as created/duplicate/rejected, then confirm() only creates the new ones', async () => {
    const imports = app.get(CustomerImportsService);
    const customers = app.get(CustomersService);

    const existing = await customers.create({
      fullName: 'Already Here',
      phoneNumber: '0798765432',
    });

    const buffer = buildWorkbookBuffer([
      { 'Customer name': 'New Person One', 'Phone number': '0711111111' },
      { 'Customer name': 'Already Here', 'Phone number': '0798765432' }, // duplicate of existing
      { 'Customer name': 'Bad Row', 'Phone number': 'not-a-number' }, // rejected
      { 'Customer name': '', 'Phone number': '0722222222' }, // rejected: missing name
    ]);

    const job = await imports.uploadAndPreview(
      {
        originalname: 'test.xlsx',
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      admin,
    );

    expect(job.createdCount).toBe(1);
    expect(job.duplicateCount).toBe(1);
    expect(job.rejectedCount).toBe(2);

    const rows = await imports.listRows(job.id);
    expect(rows.find((r) => r.rawData.fullName === 'New Person One')?.result).toBe(
      ImportRowResult.CREATED,
    );
    expect(rows.find((r) => r.customerId === existing.id)?.result).toBe(
      ImportRowResult.DUPLICATE_SKIPPED,
    );

    const completed = await imports.confirm(job.id, {}, admin);
    expect(completed.createdCount).toBe(1);

    const created = await customers.findByPhone('+254711111111');
    expect(created?.fullName).toBe('New Person One');

    // Confirming never creates a second record for the duplicate.
    const stillOne = await customers.findByPhone('+254798765432');
    expect(stillOne?.id).toBe(existing.id);
  });
});
