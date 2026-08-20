import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { resolveStationScope } from '../common/access/station-scope';
import { RequireAnyPermission } from '../common/decorators/any-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@StaffOnly()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @RequireAnyPermission(Permission.REPORTS_VIEW_ALL, Permission.REPORTS_VIEW_OWN_STATION)
  dashboard(@CurrentUser() user: StaffPrincipal, @Query('stationId') stationId?: string) {
    return this.reports.dashboard(resolveStationScope(user, stationId));
  }

  @Get('sales')
  @RequireAnyPermission(Permission.REPORTS_VIEW_ALL, Permission.REPORTS_VIEW_OWN_STATION)
  sales(
    @CurrentUser() user: StaffPrincipal,
    @Query('stationId') stationId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.salesReport({ stationId: resolveStationScope(user, stationId), from, to });
  }

  @Get('reconciliation')
  @RequireAnyPermission(Permission.REPORTS_VIEW_ALL, Permission.REPORTS_VIEW_OWN_STATION)
  reconciliation(
    @CurrentUser() user: StaffPrincipal,
    @Query('stationId') stationId?: string,
    @Query('date') date?: string,
  ) {
    return this.reports.reconciliationReport({ stationId: resolveStationScope(user, stationId), date });
  }

  @Get('disbursements')
  @RequireAnyPermission(Permission.REPORTS_VIEW_ALL, Permission.DISBURSEMENTS_VIEW)
  disbursements(@Query('month') month?: string) {
    return this.reports.disbursementsReport(month);
  }

  @Get('customer-activity')
  @RequireAnyPermission(Permission.REPORTS_VIEW_ALL, Permission.REPORTS_VIEW_OWN_STATION)
  customerActivity(@Query('customerId') customerId: string) {
    return this.reports.customerActivityReport(customerId);
  }
}
