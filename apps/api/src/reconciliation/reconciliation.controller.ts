import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { resolveStationScope } from '../common/access/station-scope';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../common/decorators/any-permission.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { IngestDailyTotalsDto } from './dto/ingest-daily-totals.dto';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('reconciliation')
@ApiBearerAuth()
@StaffOnly()
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly audit: AuditService,
  ) {}

  @Get('daily')
  @RequireAnyPermission(Permission.RECONCILIATION_VIEW_ALL, Permission.RECONCILIATION_VIEW_OWN_STATION)
  daily(@CurrentUser() user: StaffPrincipal, @Query('stationId') stationId?: string, @Query('date') date?: string) {
    return this.reconciliation.listDaily({ stationId: resolveStationScope(user, stationId), date });
  }

  @Get('daily/:id')
  @RequireAnyPermission(Permission.RECONCILIATION_VIEW_ALL, Permission.RECONCILIATION_VIEW_OWN_STATION)
  findOne(@Param('id') id: string) {
    return this.reconciliation.findById(id);
  }

  @Post('daily-totals')
  @RequirePermissions(Permission.RECONCILIATION_MANAGE)
  async ingest(@Body() dto: IngestDailyTotalsDto, @CurrentUser() actor: StaffPrincipal) {
    const record = await this.reconciliation.ingestDailyTotal(dto, actor);
    await this.audit.record({
      actor,
      action: 'reconciliation.ingest_daily_total',
      entityType: 'reconciliationDaily',
      entityId: record.id,
      metadata: { stationId: dto.stationId, product: dto.product, date: dto.date, totalSales: dto.totalSales },
    });
    return record;
  }
}
