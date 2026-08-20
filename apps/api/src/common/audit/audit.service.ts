import { Injectable } from '@nestjs/common';
import type { AuditEvent } from '@loyalty/shared';
import { FirestoreService } from '../firestore/firestore.service';
import type { AuthPrincipal } from '../types/principal';

export interface RecordAuditEventInput {
  actor: AuthPrincipal | 'system';
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Every state-changing action in the domain (price change, special-rate
 * decision, ledger transition, disbursement action, PIN reset, etc.) is
 * written here so decisions stay traceable, as required across special
 * rates, reconciliation, and disbursements.
 */
@Injectable()
export class AuditService {
  constructor(private readonly firestore: FirestoreService) {}

  async record(input: RecordAuditEventInput): Promise<void> {
    const actorName =
      input.actor === 'system'
        ? 'System'
        : input.actor.kind === 'staff'
          ? input.actor.fullName
          : input.actor.fullName;
    const actorUserId =
      input.actor === 'system'
        ? undefined
        : input.actor.kind === 'staff'
          ? input.actor.userId
          : input.actor.attendantId;

    const now = new Date().toISOString();
    const doc: Omit<AuditEvent, 'id'> = {
      actorUserId,
      actorName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    await this.firestore.collection('auditEvents').add(doc);
  }
}
