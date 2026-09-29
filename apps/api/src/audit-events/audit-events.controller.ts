import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuditEvent, PaginatedResult } from '@loyalty/shared';
import { Permission } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc } from '../common/firestore/helpers';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import { FraudFlagsService } from '../fraud/fraud-flags.service';

const PAGE_SIZE = 50;
// The audit log grows forever, so a text search can't realistically scan the
// entire history — this caps how far back (by row count, most recent first)
// a search looks, trading "the whole table" for "everything recent enough
// to plausibly be what someone's searching for."
const SEARCH_SCAN_LIMIT = 5000;

@ApiTags('audit-events')
@ApiBearerAuth()
@StaffOnly()
@RequirePermissions(Permission.AUDIT_VIEW)
@Controller('audit-events')
export class AuditEventsController {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly fraudFlags: FraudFlagsService,
  ) {}

  @Get()
  async list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
  ): Promise<PaginatedResult<AuditEvent>> {
    const col = this.firestore.collection('auditEvents');
    let query = col.orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (entityType) query = query.where('entityType', '==', entityType);
    if (entityId) query = query.where('entityId', '==', entityId);

    const needle = search?.trim().toLowerCase();
    if (needle) {
      // Matched against every recent event satisfying the filters above,
      // not just the current cursor page — see SEARCH_SCAN_LIMIT.
      const snap = await query.limit(SEARCH_SCAN_LIMIT).get();
      const items = snap.docs.map((d) => fromDoc<AuditEvent>(d));
      const matches = items.filter((e) =>
        `${e.actorName} ${e.action} ${e.entityLabel ?? ''} ${e.entityType}`.toLowerCase().includes(needle),
      );
      return {
        items: await this.enrichWithFraudFlags(matches),
        page: 1,
        pageSize: matches.length,
        total: matches.length,
        nextCursor: null,
      };
    }

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    if (cursor) {
      const cursorSnap = await col.doc(cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.limit(PAGE_SIZE).get();
    const items = snap.docs.map((d) => fromDoc<AuditEvent>(d));

    return {
      items: await this.enrichWithFraudFlags(items),
      page: 1,
      pageSize: PAGE_SIZE,
      total,
      nextCursor: snap.docs.length === PAGE_SIZE ? snap.docs.at(-1)!.id : null,
    };
  }

  /**
   * Sale entities may have a fraud flag raised against them — surfaced so
   * the Logs page can highlight those rows. One batched lookup per page
   * rather than a flag check per row.
   */
  private async enrichWithFraudFlags(items: AuditEvent[]): Promise<AuditEvent[]> {
    const saleIds = items.filter((e) => e.entityType === 'sale').map((e) => e.entityId);
    const flaggedSaleIds = await this.fraudFlags.findSaleIdsWithFlags(saleIds);
    return items.map((e) => (e.entityType === 'sale' ? { ...e, hasFraudFlag: flaggedSaleIds.has(e.entityId) } : e));
  }
}
