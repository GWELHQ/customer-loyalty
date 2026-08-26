import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { resolveStationScope } from '../common/access/station-scope';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../common/decorators/any-permission.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { SmsService } from '../sms/sms.service';
import { ApproveSalesBatchDto } from './dto/approve-sales-batch.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { RejectSaleDto } from './dto/reject-sale.dto';
import { SalesService } from './sales.service';

@ApiTags('sales')
@ApiBearerAuth()
@StaffOnly()
@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireAnyPermission(Permission.SALES_VIEW_ALL, Permission.SALES_VIEW_OWN_STATION)
  list(@CurrentUser() user: StaffPrincipal, @Query() query: ListSalesQueryDto) {
    const { stationId, product, from, to, ...pagination } = query;
    return this.sales.list(pagination, { stationId: resolveStationScope(user, stationId), product, from, to });
  }

  @Get('monthly-summary')
  @RequireAnyPermission(Permission.SALES_VIEW_ALL, Permission.SALES_VIEW_OWN_STATION)
  monthlySummary(@Query('customerId') customerId: string, @Query('month') month: string) {
    return this.sales.monthlySummary(customerId, month);
  }

  /**
   * @StaffOnly() only — deliberately no @RequirePermissions() on the three
   * approval routes below. A delegate may not normally hold
   * SALES_APPROVE_ALL/OWN_STATION (delegation can name any staff member),
   * so a fixed RBAC gate here would lock delegates out; SalesService does
   * the real per-station authorization (assertCanApproveStation), the
   * same defense-in-depth pattern special-rate-requests already uses.
   */
  @Get('pending-approval')
  listPendingApproval(@CurrentUser() actor: StaffPrincipal, @Query() query: ListSalesQueryDto) {
    const { stationId, ...pagination } = query;
    return this.sales.listPendingApproval(stationId, pagination, actor);
  }

  @Post('approve-batch')
  async approveBatch(@Body() dto: ApproveSalesBatchDto, @CurrentUser() actor: StaffPrincipal) {
    const result = await this.sales.approveBatch(dto.saleIds, actor);
    await this.audit.record({
      actor,
      action: 'sale.approve_batch',
      entityType: 'sale',
      entityId: dto.saleIds.join(','),
      metadata: { approvedCount: result.approved.length, skippedCount: result.skipped.length },
    });
    return result;
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectSaleDto, @CurrentUser() actor: StaffPrincipal) {
    const sale = await this.sales.reject(id, dto.reason, actor);
    await this.audit.record({
      actor,
      action: 'sale.reject',
      entityType: 'sale',
      entityId: id,
      metadata: { reason: dto.reason },
    });
    return sale;
  }

  @Get(':id')
  @RequireAnyPermission(Permission.SALES_VIEW_ALL, Permission.SALES_VIEW_OWN_STATION)
  findOne(@Param('id') id: string) {
    return this.sales.findById(id);
  }

  /** Admin manual sale entry — RTSM/Admin correcting or backfilling a record. Same rules and calculation apply as Android. */
  @Post()
  @RequirePermissions(Permission.CUSTOMERS_MANAGE)
  async create(@Body() dto: CreateSaleDto, @CurrentUser() actor: StaffPrincipal) {
    const sale = await this.sales.createSale(dto, actor);
    await this.audit.record({
      actor,
      action: 'sale.create_manual',
      entityType: 'sale',
      entityId: sale.id,
      entityLabel: `${sale.customerPhoneAtSale} · ${sale.stationNameAtSale}`,
      metadata: { stationId: sale.stationId, product: sale.product },
    });
    return sale;
  }

  @Post(':id/sms/retry')
  @RequireAnyPermission(Permission.SALES_VIEW_ALL, Permission.SALES_VIEW_OWN_STATION)
  async retrySms(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const delivery = await this.sms.retry(id);
    await this.audit.record({
      actor,
      action: 'sale.sms_retry',
      entityType: 'sale',
      entityId: id,
    });
    return delivery;
  }
}
