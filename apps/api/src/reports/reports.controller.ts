import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, type SalesReportGroupBy } from '@loyalty/shared';
import { resolveStationScope } from '../common/access/station-scope';
import { RequireAnyPermission } from '../common/decorators/any-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import {
  nairobiMonthBoundsUtc,
  nairobiMonthKey,
  nairobiQuarterBoundsUtc,
  nairobiQuarterKey,
  nairobiYearBoundsUtc,
} from '../common/time/nairobi';
import type { StaffPrincipal } from '../common/types/principal';
import { ReportsService } from './reports.service';

type SalesReportPreset = 'this_month' | 'this_quarter' | 'ytd';

/** Resolves a named preset to a from/to window server-side, so Nairobi
 * timezone correctness stays centralized (the rest of the app never does
 * its own date-boundary arithmetic client-side either). No/unrecognized
 * preset passes the caller's from/to straight through (custom range). */
function resolveReportRange(preset: string | undefined, from?: string, to?: string): { from?: string; to?: string } {
  if (preset === 'this_month') {
    const b = nairobiMonthBoundsUtc(nairobiMonthKey());
    return { from: b.startUtc, to: b.endUtc };
  }
  if (preset === 'this_quarter') {
    const b = nairobiQuarterBoundsUtc(nairobiQuarterKey());
    return { from: b.startUtc, to: b.endUtc };
  }
  if (preset === 'ytd') {
    const year = Number(nairobiQuarterKey().slice(0, 4));
    return { from: nairobiYearBoundsUtc(year).startUtc, to: new Date().toISOString() };
  }
  return { from, to };
}

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
    @Query('preset') preset?: SalesReportPreset,
    @Query('groupBy') groupBy?: SalesReportGroupBy,
  ) {
    const range = resolveReportRange(preset, from, to);
    return this.reports.salesReport({ stationId: resolveStationScope(user, stationId), ...range, groupBy });
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
