import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RbacService } from './rbac.service';

/**
 * Reads (roles/permissions catalogue) are reachable by any authenticated
 * staff member — every page in the app needs role display names, and the
 * permission picker needs the full catalogue. Only create/update/delete
 * require RBAC_MANAGE, granted by default only to Admin.
 */
@ApiTags('rbac')
@ApiBearerAuth()
@StaffOnly()
@Controller('rbac')
export class RbacController {
  constructor(
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  @Get('roles')
  listRoles() {
    return this.rbac.listRoles();
  }

  @Get('roles/:key')
  getRole(@Param('key') key: string) {
    return this.rbac.getRoleDefinition(key);
  }

  @Get('permissions')
  listPermissions() {
    return this.rbac.listPermissions();
  }

  @Post('roles')
  @RequirePermissions(Permission.RBAC_MANAGE)
  async createRole(@Body() dto: CreateRoleDto, @CurrentUser() actor: StaffPrincipal) {
    const role = await this.rbac.createRole(dto, actor.userId);
    await this.audit.record({
      actor,
      action: 'role.create',
      entityType: 'roleDefinition',
      entityId: role.key,
      entityLabel: role.displayName,
      metadata: { permissions: role.permissions },
    });
    return role;
  }

  @Patch('roles/:key')
  @RequirePermissions(Permission.RBAC_MANAGE)
  async updateRole(@Param('key') key: string, @Body() dto: UpdateRoleDto, @CurrentUser() actor: StaffPrincipal) {
    const role = await this.rbac.updateRole(key, dto, actor.userId);
    await this.audit.record({
      actor,
      action: 'role.update',
      entityType: 'roleDefinition',
      entityId: role.key,
      entityLabel: role.displayName,
      metadata: { permissions: role.permissions },
    });
    return role;
  }

  @Delete('roles/:key')
  @RequirePermissions(Permission.RBAC_MANAGE)
  async deleteRole(@Param('key') key: string, @CurrentUser() actor: StaffPrincipal) {
    await this.rbac.deleteRole(key);
    await this.audit.record({
      actor,
      action: 'role.delete',
      entityType: 'roleDefinition',
      entityId: key,
    });
    return { success: true };
  }
}
