import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuditEvent, PaginatedResult } from '@loyalty/shared';
import { Permission } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc } from '../common/firestore/helpers';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';

const PAGE_SIZE = 50;

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
    @Query('cursor') cursor?: string,
  ): Promise<PaginatedResult<AuditEvent>> {
    const col = this.firestore.collection('auditEvents');
    let query = col.orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (entityType) query = query.where('entityType', '==', entityType);
    if (entityId) query = query.where('entityId', '==', entityId);

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    if (cursor) {
      const cursorSnap = await col.doc(cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.limit(PAGE_SIZE).get();
    const items = snap.docs.map((d) => fromDoc<AuditEvent>(d));

    return {
      items,
      page: 1,
      pageSize: PAGE_SIZE,
      total,
      nextCursor: snap.docs.length === PAGE_SIZE ? snap.docs.at(-1)!.id : null,
    };
  }
}
