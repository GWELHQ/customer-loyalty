import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationType, Permission, Role } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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

  @Post(':month/submit')
  @RequirePermissions(Permission.LEDGERS_MANAGE)
  async submit(@Param('month') month: string, @CurrentUser() actor: StaffPrincipal) {
    const ledger = await this.ledgers.submit(month, actor);
    await this.audit.record({ actor, action: 'ledger.submit', entityType: 'monthlyCashbackLedger', entityId: month });
    const finance = (await this.users.list()).filter((u) => u.role === Role.FINANCE);
    await this.notifications.notifyMany(
      finance.map((f) => f.id),
      {
        type: NotificationType.LEDGER_STATE_CHANGE,
        title: `Cashback ledger for ${month} submitted`,
        body: `${actor.fullName} submitted the ${month} ledger for approval.`,
        linkPath: `/cashback-ledgers/${month}`,
      },
    );
    return ledger;
  }

  @Post(':month/approve')
  @RequirePermissions(Permission.LEDGERS_APPROVE)
  async approve(@Param('month') month: string, @CurrentUser() actor: StaffPrincipal) {
    const ledger = await this.ledgers.approve(month, actor);
    await this.audit.record({ actor, action: 'ledger.approve', entityType: 'monthlyCashbackLedger', entityId: month });
    return ledger;
  }

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
    return ledger;
  }
}
