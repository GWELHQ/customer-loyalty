import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { StationsService } from './stations.service';

@ApiTags('stations')
@ApiBearerAuth()
@StaffOnly()
@Controller('stations')
export class StationsController {
  constructor(
    private readonly stations: StationsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.STATIONS_VIEW)
  list() {
    return this.stations.list();
  }

  @Get(':id')
  @RequirePermissions(Permission.STATIONS_VIEW)
  findOne(@Param('id') id: string) {
    return this.stations.findById(id);
  }

  @Post()
  @RequirePermissions(Permission.STATIONS_MANAGE)
  async create(@Body() dto: CreateStationDto, @CurrentUser() actor: StaffPrincipal) {
    const station = await this.stations.create(dto);
    await this.audit.record({
      actor,
      action: 'station.create',
      entityType: 'station',
      entityId: station.id,
      entityLabel: station.name,
    });
    return station;
  }

  @Patch(':id')
  @RequirePermissions(Permission.STATIONS_MANAGE)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStationDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const station = await this.stations.update(id, dto);
    await this.audit.record({
      actor,
      action: 'station.update',
      entityType: 'station',
      entityId: id,
      entityLabel: station.name,
    });
    return station;
  }
}
