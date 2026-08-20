import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { CompleteBatchDto } from './dto/complete-batch.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { HoldBatchDto } from './dto/hold-batch.dto';
import { DisbursementBatchesService } from './disbursement-batches.service';

@ApiTags('disbursement-batches')
@ApiBearerAuth()
@StaffOnly()
@Controller('disbursement-batches')
export class DisbursementBatchesController {
  constructor(
    private readonly batches: DisbursementBatchesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.DISBURSEMENTS_VIEW)
  list(@Query('month') month?: string) {
    return this.batches.list(month);
  }

  @Get(':id')
  @RequirePermissions(Permission.DISBURSEMENTS_VIEW)
  findOne(@Param('id') id: string) {
    return this.batches.findById(id);
  }

  @Post()
  @RequirePermissions(Permission.DISBURSEMENTS_MANAGE)
  async create(@Body() dto: CreateBatchDto, @CurrentUser() actor: StaffPrincipal) {
    const batch = await this.batches.create(dto.month, actor);
    await this.audit.record({
      actor,
      action: 'disbursement_batch.create',
      entityType: 'disbursementBatch',
      entityId: batch.id,
      metadata: { month: dto.month, totalAmount: batch.totalAmount },
    });
    return batch;
  }

  @Post(':id/confirm')
  @RequirePermissions(Permission.DISBURSEMENTS_MANAGE)
  async confirm(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const batch = await this.batches.confirm(id, actor);
    await this.audit.record({ actor, action: 'disbursement_batch.confirm', entityType: 'disbursementBatch', entityId: id });
    return batch;
  }

  @Post(':id/mark-processing')
  @RequirePermissions(Permission.DISBURSEMENTS_MANAGE)
  async markProcessing(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const batch = await this.batches.markProcessing(id);
    await this.audit.record({ actor, action: 'disbursement_batch.mark_processing', entityType: 'disbursementBatch', entityId: id });
    return batch;
  }

  @Post(':id/complete')
  @RequirePermissions(Permission.DISBURSEMENTS_MANAGE)
  async complete(
    @Param('id') id: string,
    @Body() dto: CompleteBatchDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const batch = await this.batches.complete(id, dto.results);
    await this.audit.record({
      actor,
      action: 'disbursement_batch.complete',
      entityType: 'disbursementBatch',
      entityId: id,
      metadata: { status: batch.status },
    });
    return batch;
  }

  @Post(':id/hold')
  @RequirePermissions(Permission.DISBURSEMENTS_MANAGE)
  async hold(@Param('id') id: string, @Body() dto: HoldBatchDto, @CurrentUser() actor: StaffPrincipal) {
    const batch = await this.batches.hold(id, dto.reason);
    await this.audit.record({
      actor,
      action: 'disbursement_batch.hold',
      entityType: 'disbursementBatch',
      entityId: id,
      metadata: { reason: dto.reason },
    });
    return batch;
  }
}
