import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { assertStationAccessible, resolveStationScope } from '../common/access/station-scope';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../common/decorators/any-permission.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { RecordShiftRosterDto } from './dto/record-shift-roster.dto';
import { ShiftsService } from './shifts.service';

/**
 * Daily attendant shift rosters — a Station Supervisor records who's on
 * duty at their station each day/shift; Admin/RTSM/Chairman-tier roles
 * see every station. Also the data source for FraudDetectionService's
 * "attendant outside shift" check.
 */
@ApiTags('shifts')
@ApiBearerAuth()
@StaffOnly()
@Controller('shifts')
export class ShiftsController {
  constructor(
    private readonly shifts: ShiftsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireAnyPermission(Permission.SHIFTS_VIEW_ALL, Permission.SHIFTS_VIEW_OWN_STATION)
  list(@CurrentUser() user: StaffPrincipal, @Query('stationId') stationId?: string, @Query('date') date?: string) {
    return this.shifts.listRosters({ stationId: resolveStationScope(user, stationId), date });
  }

  @Post()
  @RequirePermissions(Permission.SHIFTS_MANAGE)
  async record(@Body() dto: RecordShiftRosterDto, @CurrentUser() actor: StaffPrincipal) {
    assertStationAccessible(actor, dto.stationId);
    const roster = await this.shifts.recordRoster(dto, actor);
    await this.audit.record({
      actor,
      action: 'shift.roster_record',
      entityType: 'shiftRoster',
      entityId: roster.id,
      entityLabel: `${dto.shift} · ${dto.date}`,
      metadata: { stationId: dto.stationId, shift: dto.shift, date: dto.date, attendantCount: dto.attendantIds.length },
    });
    return roster;
  }
}
