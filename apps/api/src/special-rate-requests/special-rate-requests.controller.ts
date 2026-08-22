import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationType, Permission, Role, SpecialRateStatus } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import type { StaffPrincipal } from '../common/types/principal';
import { CreateSpecialRateRequestDto } from './dto/create-special-rate-request.dto';
import { DecideSpecialRateRequestDto } from './dto/decide-special-rate-request.dto';
import { SpecialRateRequestsService } from './special-rate-requests.service';
import { UsersService } from '../users/users.service';

@ApiTags('special-rate-requests')
@ApiBearerAuth()
@StaffOnly()
@Controller('special-rate-requests')
export class SpecialRateRequestsController {
  constructor(
    private readonly requests: SpecialRateRequestsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @RequirePermissions(Permission.SPECIAL_RATES_VIEW)
  list(@Query('status') status?: SpecialRateStatus) {
    return this.requests.list(status);
  }

  @Get(':id')
  @RequirePermissions(Permission.SPECIAL_RATES_VIEW)
  findOne(@Param('id') id: string) {
    return this.requests.findById(id);
  }

  @Post()
  @RequirePermissions(Permission.SPECIAL_RATES_REQUEST)
  async create(@Body() dto: CreateSpecialRateRequestDto, @CurrentUser() actor: StaffPrincipal) {
    const request = await this.requests.create(dto, actor);
    await this.audit.record({
      actor,
      action: request.status === SpecialRateStatus.APPROVED
        ? 'special_rate_request.create_and_apply'
        : 'special_rate_request.create',
      entityType: 'specialRateRequest',
      entityId: request.id,
    });

    // A Chairman-initiated request is already applied — nothing left for
    // the Chairman to be notified about approving.
    if (request.status === SpecialRateStatus.PENDING) {
      const chairs = (await this.users.list()).filter((u) => u.role === Role.CHAIRMAN);
      await this.notifications.notifyMany(
        chairs.map((c) => c.id),
        {
          type: NotificationType.SPECIAL_RATE_REQUEST,
          title: 'New special rate request',
          body: `${actor.fullName} requested a special rate for a customer.`,
          linkPath: `/special-rates/${request.id}`,
        },
      );
    }

    return request;
  }

  @Post(':id/approve')
  @RequirePermissions(Permission.SPECIAL_RATES_APPROVE)
  async approve(
    @Param('id') id: string,
    @Body() dto: DecideSpecialRateRequestDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const request = await this.requests.decide(id, 'approved', dto.decisionNote, actor);
    await this.audit.record({
      actor,
      action: 'special_rate_request.approve',
      entityType: 'specialRateRequest',
      entityId: id,
    });
    await this.notifications.notify({
      userId: request.requestedByUserId,
      type: NotificationType.SPECIAL_RATE_DECISION,
      title: 'Special rate request approved',
      body: `Your special rate request was approved by ${actor.fullName}.`,
      linkPath: `/special-rates/${id}`,
    });
    return request;
  }

  @Post(':id/reject')
  @RequirePermissions(Permission.SPECIAL_RATES_APPROVE)
  async reject(
    @Param('id') id: string,
    @Body() dto: DecideSpecialRateRequestDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const request = await this.requests.decide(id, 'rejected', dto.decisionNote, actor);
    await this.audit.record({
      actor,
      action: 'special_rate_request.reject',
      entityType: 'specialRateRequest',
      entityId: id,
    });
    await this.notifications.notify({
      userId: request.requestedByUserId,
      type: NotificationType.SPECIAL_RATE_DECISION,
      title: 'Special rate request rejected',
      body: `Your special rate request was rejected by ${actor.fullName}.`,
      linkPath: `/special-rates/${id}`,
    });
    return request;
  }

  @Post(':id/revoke')
  @RequirePermissions(Permission.SPECIAL_RATES_APPROVE)
  async revoke(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const request = await this.requests.revoke(id, actor);
    await this.audit.record({
      actor,
      action: 'special_rate_request.revoke',
      entityType: 'specialRateRequest',
      entityId: id,
    });
    // Skip the notification when the Chairman is revoking a rate they
    // both requested and applied themselves (see create()'s
    // Chairman-direct-apply path) — no one else to tell.
    if (request.requestedByUserId !== actor.userId) {
      await this.notifications.notify({
        userId: request.requestedByUserId,
        type: NotificationType.SPECIAL_RATE_DECISION,
        title: 'Special rate removed',
        body: `${actor.fullName} removed a special rate you requested.`,
        linkPath: `/special-rates/${id}`,
      });
    }
    return request;
  }
}
