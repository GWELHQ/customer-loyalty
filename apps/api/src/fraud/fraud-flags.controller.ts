import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FraudFlagStatus, FraudFlagType, Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { DecideFraudFlagDto } from './dto/decide-fraud-flag.dto';
import { FraudFlagsService } from './fraud-flags.service';

@ApiTags('fraud-flags')
@ApiBearerAuth()
@StaffOnly()
@Controller('fraud-flags')
export class FraudFlagsController {
  constructor(
    private readonly flags: FraudFlagsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.FRAUD_VIEW)
  list(
    @Query('type') type?: FraudFlagType,
    @Query('status') status?: FraudFlagStatus,
    @Query('stationId') stationId?: string,
    @Query('customerId') customerId?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.flags.list({ type, status, stationId, customerId }, cursor);
  }

  @Get(':id')
  @RequirePermissions(Permission.FRAUD_VIEW)
  findOne(@Param('id') id: string) {
    return this.flags.findById(id);
  }

  @Patch(':id/start-review')
  @RequirePermissions(Permission.FRAUD_MANAGE)
  async startReview(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const flag = await this.flags.startReview(id, actor);
    await this.audit.record({
      actor,
      action: 'fraud_flag.start_review',
      entityType: 'fraudFlags',
      entityId: id,
      entityLabel: flag.type,
    });
    return flag;
  }

  @Patch(':id/resolve')
  @RequirePermissions(Permission.FRAUD_MANAGE)
  async resolve(@Param('id') id: string, @Body() dto: DecideFraudFlagDto, @CurrentUser() actor: StaffPrincipal) {
    const flag = await this.flags.decide(id, 'resolved', dto.note, actor);
    await this.audit.record({
      actor,
      action: 'fraud_flag.resolve',
      entityType: 'fraudFlags',
      entityId: id,
      entityLabel: flag.type,
      metadata: { note: dto.note },
    });
    return flag;
  }

  @Patch(':id/dismiss')
  @RequirePermissions(Permission.FRAUD_MANAGE)
  async dismiss(@Param('id') id: string, @Body() dto: DecideFraudFlagDto, @CurrentUser() actor: StaffPrincipal) {
    const flag = await this.flags.decide(id, 'dismissed', dto.note, actor);
    await this.audit.record({
      actor,
      action: 'fraud_flag.dismiss',
      entityType: 'fraudFlags',
      entityId: id,
      entityLabel: flag.type,
      metadata: { note: dto.note },
    });
    return flag;
  }
}
