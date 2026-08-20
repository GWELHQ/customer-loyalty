import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, Product } from '@loyalty/shared';
import { resolveStationScope } from '../common/access/station-scope';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../common/decorators/any-permission.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { StaffPrincipal } from '../common/types/principal';
import { SmsService } from '../sms/sms.service';
import { CreateSaleDto } from './dto/create-sale.dto';
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
  list(
    @CurrentUser() user: StaffPrincipal,
    @Query() pagination: PaginationQueryDto,
    @Query('stationId') stationId?: string,
    @Query('product') product?: Product,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.sales.list(pagination, { stationId: resolveStationScope(user, stationId), product, from, to });
  }

  @Get('monthly-summary')
  @RequireAnyPermission(Permission.SALES_VIEW_ALL, Permission.SALES_VIEW_OWN_STATION)
  monthlySummary(@Query('customerId') customerId: string, @Query('month') month: string) {
    return this.sales.monthlySummary(customerId, month);
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
