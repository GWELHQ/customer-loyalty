import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { buildDisbursementExportText } from './disbursement-export';
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

  /** Tab-delimited bank bulk-payment file for the Finance Disburser to upload — see disbursement-export.ts. */
  @Get(':id/export.txt')
  @RequirePermissions(Permission.DISBURSEMENTS_MANAGE)
  async exportFile(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal, @Res() res: Response) {
    const batch = await this.batches.findById(id);
    const text = buildDisbursementExportText(batch);
    await this.audit.record({
      actor,
      action: 'disbursement_batch.export',
      entityType: 'disbursementBatch',
      entityId: id,
      entityLabel: batch.month,
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="green-wells-${batch.month}-disbursement.txt"`);
    res.send(text);
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
      entityLabel: batch.month,
      metadata: { month: dto.month, totalAmount: batch.totalAmount },
    });
    return batch;
  }

  @Post(':id/confirm')
  @RequirePermissions(Permission.DISBURSEMENTS_MANAGE)
  async confirm(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const batch = await this.batches.confirm(id, actor);
    await this.audit.record({ actor, action: 'disbursement_batch.confirm', entityType: 'disbursementBatch', entityId: id, entityLabel: batch.month });
    return batch;
  }

  @Post(':id/mark-processing')
  @RequirePermissions(Permission.DISBURSEMENTS_MANAGE)
  async markProcessing(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const batch = await this.batches.markProcessing(id);
    await this.audit.record({ actor, action: 'disbursement_batch.mark_processing', entityType: 'disbursementBatch', entityId: id, entityLabel: batch.month });
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
      entityLabel: batch.month,
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
      entityLabel: batch.month,
      metadata: { reason: dto.reason },
    });
    return batch;
  }
}
