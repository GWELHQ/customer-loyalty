import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationType, Permission, Role, type User } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EmailService } from '../common/email/email.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { CashbackLedgersService } from './cashback-ledgers.service';
import { RejectLedgerDto } from './dto/reject-ledger.dto';

@ApiTags('cashback-ledgers')
@ApiBearerAuth()
@StaffOnly()
@Controller('cashback-ledgers')
export class CashbackLedgersController {
  constructor(
    private readonly ledgers: CashbackLedgersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    private readonly email: EmailService,
  ) {}

  @Get()
  @RequirePermissions(Permission.LEDGERS_VIEW)
  list() {
    return this.ledgers.list();
  }

  @Get(':month')
  @RequirePermissions(Permission.LEDGERS_VIEW)
  findOne(@Param('month') month: string) {
    return this.ledgers.getOrCreate(month);
  }

  /** RTSM (or Admin) releases the month's ledger for Finance Approver review. */
  @Post(':month/submit')
  @RequirePermissions(Permission.LEDGERS_MANAGE)
  async submit(@Param('month') month: string, @CurrentUser() actor: StaffPrincipal) {
    const ledger = await this.ledgers.submit(month, actor);
    await this.audit.record({ actor, action: 'ledger.submit', entityType: 'monthlyCashbackLedger', entityId: month });
    await this.notifyRole(Role.FINANCE_APPROVER, {
      title: `Cashback ledger for ${month} released for approval`,
      body: `${actor.fullName} released the ${month} ledger — please review and approve or reject it.`,
      linkPath: `/cashback-ledgers`,
      subject: `Green Wells: ledger for ${month} awaiting your approval`,
    });
    return ledger;
  }

  /** Finance Approver approves — Finance Disburser is notified it's ready to pay out, and the releasing RTSM is notified it was approved. */
  @Post(':month/approve')
  @RequirePermissions(Permission.LEDGERS_APPROVE)
  async approve(@Param('month') month: string, @CurrentUser() actor: StaffPrincipal) {
    const ledger = await this.ledgers.approve(month, actor);
    await this.audit.record({ actor, action: 'ledger.approve', entityType: 'monthlyCashbackLedger', entityId: month });

    await this.notifyRole(Role.FINANCE_DISBURSER, {
      title: `Cashback ledger for ${month} approved — ready to disburse`,
      body: `${actor.fullName} approved the ${month} ledger. It's ready for disbursement.`,
      linkPath: `/disbursements`,
      subject: `Green Wells: ledger for ${month} ready to disburse`,
    });
    if (ledger.submittedByUserId) {
      await this.notifyUserIds([ledger.submittedByUserId], {
        title: `Cashback ledger for ${month} approved`,
        body: `${actor.fullName} approved the ${month} ledger you released.`,
        linkPath: `/cashback-ledgers`,
        subject: `Green Wells: ledger for ${month} was approved`,
      });
    }
    return ledger;
  }

  /** Finance Approver rejects — the releasing RTSM is notified with the reason. */
  @Post(':month/reject')
  @RequirePermissions(Permission.LEDGERS_APPROVE)
  async reject(
    @Param('month') month: string,
    @Body() dto: RejectLedgerDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const ledger = await this.ledgers.reject(month, dto.reason, actor);
    await this.audit.record({
      actor,
      action: 'ledger.reject',
      entityType: 'monthlyCashbackLedger',
      entityId: month,
      metadata: { reason: dto.reason },
    });
    if (ledger.submittedByUserId) {
      await this.notifyUserIds([ledger.submittedByUserId], {
        title: `Cashback ledger for ${month} rejected`,
        body: `${actor.fullName} rejected the ${month} ledger: "${dto.reason}"`,
        linkPath: `/cashback-ledgers`,
        subject: `Green Wells: ledger for ${month} was rejected`,
      });
    }
    return ledger;
  }

  private async notifyRole(
    role: Role,
    input: { title: string; body: string; linkPath: string; subject: string },
  ): Promise<void> {
    const recipients = (await this.users.list()).filter((u) => u.role === role);
    await this.notifyUsers(recipients, input);
  }

  private async notifyUserIds(
    userIds: string[],
    input: { title: string; body: string; linkPath: string; subject: string },
  ): Promise<void> {
    const recipients = (await this.users.list()).filter((u) => userIds.includes(u.id));
    await this.notifyUsers(recipients, input);
  }

  private async notifyUsers(
    recipients: User[],
    input: { title: string; body: string; linkPath: string; subject: string },
  ): Promise<void> {
    if (recipients.length === 0) return;
    await this.notifications.notifyMany(
      recipients.map((u) => u.id),
      { type: NotificationType.LEDGER_STATE_CHANGE, title: input.title, body: input.body, linkPath: input.linkPath },
    );
    await this.email.send(
      recipients.map((u) => u.email),
      input.subject,
      input.body,
    );
  }
}
