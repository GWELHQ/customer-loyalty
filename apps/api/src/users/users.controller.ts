import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@StaffOnly()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.USERS_MANAGE)
  list() {
    return this.users.list();
  }

  @Get(':id')
  @RequirePermissions(Permission.USERS_MANAGE)
  findOne(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Post()
  @RequirePermissions(Permission.USERS_MANAGE)
  async create(@Body() dto: CreateUserDto, @CurrentUser() actor: StaffPrincipal) {
    const user = await this.users.create(dto, actor);
    await this.audit.record({
      actor,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.fullName,
      metadata: { role: user.role },
    });
    return user;
  }

  @Patch(':id')
  @RequirePermissions(Permission.USERS_MANAGE)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const user = await this.users.update(id, dto, actor);
    await this.audit.record({ actor, action: 'user.update', entityType: 'user', entityId: id, entityLabel: user.fullName });
    return user;
  }

  @Patch(':id/status')
  @RequirePermissions(Permission.USERS_MANAGE)
  async setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const user = await this.users.setStatus(id, dto.status);
    await this.audit.record({
      actor,
      action: 'user.status_change',
      entityType: 'user',
      entityId: id,
      entityLabel: user.fullName,
      metadata: { status: dto.status },
    });
    return user;
  }
}
