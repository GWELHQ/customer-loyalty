import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuditEvent } from '@loyalty/shared';
import { Permission } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc } from '../common/firestore/helpers';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';

@ApiTags('audit-events')
@ApiBearerAuth()
@StaffOnly()
@RequirePermissions(Permission.AUDIT_VIEW)
@Controller('audit-events')
export class AuditEventsController {
  constructor(private readonly firestore: FirestoreService) {}

  @Get()
  async list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('limit') limit = '100',
  ): Promise<AuditEvent[]> {
    let query = this.firestore
      .collection('auditEvents')
      .orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (entityType) query = query.where('entityType', '==', entityType);
    if (entityId) query = query.where('entityId', '==', entityId);
    const snap = await query.limit(Math.min(Number(limit) || 100, 500)).get();
    return snap.docs.map((d) => fromDoc<AuditEvent>(d));
  }
}
