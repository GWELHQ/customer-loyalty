import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { LedgerPayoutService } from './ledger-payout.service';

/** Ledger-page payout routes — see LedgerPayoutService. Lives in this module (not CashbackLedgersModule) because it needs the disbursement settings and cashback trend. */
@ApiTags('cashback-ledgers')
@ApiBearerAuth()
@StaffOnly()
@Controller('cashback-ledgers')
export class LedgerPayoutController {
  constructor(
    private readonly payout: LedgerPayoutService,
    private readonly audit: AuditService,
  ) {}

  /** One tab-delimited bank payment file for every station combined. */
  @Get(':month/payment-file.txt')
  @RequirePermissions(Permission.LEDGERS_EXPORT_PAYMENT_FILE)
  async paymentFile(@Param('month') month: string, @CurrentUser() actor: StaffPrincipal, @Res() res: Response) {
    const { text, rows } = await this.payout.paymentFile(month);
    await this.audit.record({
      actor,
      action: 'ledger.export_payment_file',
      entityType: 'monthlyCashbackLedger',
      entityId: month,
      metadata: { customers: rows.length, totalAmount: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100 },
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="green-wells-${month}-all-stations-disbursement.txt"`);
    res.send(text);
  }

  @Post(':month/mark-disbursed')
  @RequirePermissions(Permission.LEDGERS_MARK_DISBURSED)
  async markDisbursed(@Param('month') month: string, @CurrentUser() actor: StaffPrincipal) {
    const ledger = await this.payout.markDisbursed(month, actor);
    await this.audit.record({
      actor,
      action: 'ledger.mark_disbursed',
      entityType: 'monthlyCashbackLedger',
      entityId: month,
      metadata: {
        customers: ledger.payoutRows?.length ?? 0,
        totalAmount: Math.round((ledger.payoutRows ?? []).reduce((s, r) => s + r.amount, 0) * 100) / 100,
      },
    });
    return ledger;
  }
}
