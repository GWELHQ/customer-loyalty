import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { AttendantsService } from './attendants.service';
import { AssignStationDto } from './dto/assign-station.dto';
import { CreateAttendantDto } from './dto/create-attendant.dto';
import { ResetPinDto } from './dto/reset-pin.dto';
import { UpdateAttendantDto } from './dto/update-attendant.dto';
import { UpdateAttendantStatusDto } from './dto/update-attendant-status.dto';

/**
 * Attendant lifecycle management — Admin-only, per the spec ("Each
 * attendant account is created by an Admin"). Distinct from /users because
 * Attendant is a separate Firestore collection/entity (PIN, employeeId)
 * from the Microsoft-authenticated User.
 */
@ApiTags('attendants')
@ApiBearerAuth()
@StaffOnly()
@RequirePermissions(Permission.ATTENDANTS_MANAGE)
@Controller('attendants')
export class AttendantsController {
  constructor(
    private readonly attendants: AttendantsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query('stationId') stationId?: string) {
    return this.attendants.list(stationId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.attendants.findById(id);
  }

  @Post()
  async create(@Body() dto: CreateAttendantDto, @CurrentUser() actor: StaffPrincipal) {
    const attendant = await this.attendants.create(dto);
    await this.audit.record({
      actor,
      action: 'attendant.create',
      entityType: 'attendant',
      entityId: attendant.id,
      entityLabel: attendant.fullName,
      metadata: { assignedStationId: attendant.assignedStationId },
    });
    return attendant;
  }

  @Post(':id/reset-pin')
  async resetPin(
    @Param('id') id: string,
    @Body() dto: ResetPinDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const attendant = await this.attendants.findById(id);
    await this.attendants.resetPin(id, dto.newPin);
    await this.audit.record({
      actor,
      action: 'attendant.pin_reset',
      entityType: 'attendant',
      entityId: id,
      entityLabel: attendant?.fullName,
    });
    return { success: true };
  }

  @Patch(':id/status')
  async setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAttendantStatusDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const attendant = await this.attendants.setStatus(id, dto.status);
    await this.audit.record({
      actor,
      action: 'attendant.status_change',
      entityType: 'attendant',
      entityId: id,
      entityLabel: attendant.fullName,
      metadata: { status: dto.status },
    });
    return attendant;
  }

  @Patch(':id/station')
  async assignStation(
    @Param('id') id: string,
    @Body() dto: AssignStationDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const attendant = await this.attendants.assignStation(id, dto.stationId);
    await this.audit.record({
      actor,
      action: 'attendant.station_assign',
      entityType: 'attendant',
      entityId: id,
      entityLabel: attendant.fullName,
      metadata: { stationId: dto.stationId },
    });
    return attendant;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAttendantDto, @CurrentUser() actor: StaffPrincipal) {
    const attendant = await this.attendants.update(id, dto);
    await this.audit.record({
      actor,
      action: 'attendant.update',
      entityType: 'attendant',
      entityId: id,
      entityLabel: attendant.fullName,
      metadata: { fullName: dto.fullName, employeeId: dto.employeeId, nfcTagAssigned: dto.nfcTagId !== undefined },
    });
    return attendant;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const attendant = await this.attendants.delete(id);
    await this.audit.record({
      actor,
      action: 'attendant.delete',
      entityType: 'attendant',
      entityId: id,
      entityLabel: attendant.fullName,
    });
    return { success: true };
  }
}
