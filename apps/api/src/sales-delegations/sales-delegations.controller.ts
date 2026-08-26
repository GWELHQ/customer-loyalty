import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { CreateSalesDelegationDto } from './dto/create-sales-delegation.dto';
import { SalesDelegationsService } from './sales-delegations.service';

/**
 * @StaffOnly() only — deliberately no @RequirePermissions(). Who may act
 * here is "this station's supervisor, or Admin," which the service itself
 * checks (assertCanManage) — a fixed RBAC permission can't express "the
 * supervisor of whichever station this delegation targets."
 */
@ApiTags('sales-delegations')
@ApiBearerAuth()
@StaffOnly()
@Controller('sales-delegations')
export class SalesDelegationsController {
  constructor(
    private readonly delegations: SalesDelegationsService,
    private readonly audit: AuditService,
  ) {}

  @Get('eligible-staff')
  listEligibleStaff() {
    return this.delegations.listEligibleStaff();
  }

  @Get()
  listForStation(@Query('stationId') stationId: string) {
    return this.delegations.listForStation(stationId);
  }

  @Post()
  async create(@Body() dto: CreateSalesDelegationDto, @CurrentUser() actor: StaffPrincipal) {
    const delegation = await this.delegations.create(dto, actor);
    await this.audit.record({
      actor,
      action: 'sale_approval_delegation.create',
      entityType: 'saleApprovalDelegations',
      entityId: delegation.id,
      entityLabel: `${delegation.stationNameAtDelegation} → ${delegation.delegateName}`,
    });
    return delegation;
  }

  @Post(':id/revoke')
  async revoke(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const delegation = await this.delegations.revoke(id, actor);
    await this.audit.record({
      actor,
      action: 'sale_approval_delegation.revoke',
      entityType: 'saleApprovalDelegations',
      entityId: id,
      entityLabel: `${delegation.stationNameAtDelegation} → ${delegation.delegateName}`,
    });
    return delegation;
  }
}
