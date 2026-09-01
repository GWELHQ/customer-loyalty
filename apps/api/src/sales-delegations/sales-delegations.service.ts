import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus, type SaleApprovalDelegation } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { StationsService } from '../stations/stations.service';
import type { StaffPrincipal } from '../common/types/principal';
import { UsersService } from '../users/users.service';

const COLLECTION = 'saleApprovalDelegations';

@Injectable()
export class SalesDelegationsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly stations: StationsService,
    private readonly users: UsersService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  /** A supervisor may only manage their own station's delegation; Admin may manage any station. */
  private assertCanManage(actor: StaffPrincipal, stationId: string): void {
    if (actor.role === Role.ADMIN) return;
    if (actor.role === Role.STATION_SUPERVISOR && actor.assignedStationId === stationId) return;
    throw new ForbiddenException('You do not have access to manage this station’s delegation');
  }

  async create(
    input: { stationId: string; delegateUserId: string; startDate: string; endDate: string },
    actor: StaffPrincipal,
  ): Promise<SaleApprovalDelegation> {
    this.assertCanManage(actor, input.stationId);
    if (new Date(input.endDate) <= new Date(input.startDate)) {
      throw new ForbiddenException('endDate must be after startDate');
    }

    const [station, delegate] = await Promise.all([
      this.stations.findById(input.stationId),
      this.users.findById(input.delegateUserId),
    ]);
    if (!station) throw new NotFoundException('Station not found');
    if (!delegate) throw new NotFoundException('Delegate user not found');

    // One active delegate per station — superseding an existing one keeps
    // "who can currently approve for this station" unambiguous.
    const current = await this.getActiveForStation(input.stationId);
    if (current) await this.revoke(current.id, actor);

    const now = nowIso();
    const doc: Omit<SaleApprovalDelegation, 'id'> = {
      stationId: input.stationId,
      stationNameAtDelegation: station.name,
      delegatorUserId: actor.userId,
      delegatorName: actor.fullName,
      delegateUserId: delegate.id,
      delegateName: delegate.fullName,
      startDate: input.startDate,
      endDate: input.endDate,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    return { ...doc, id: ref.id };
  }

  async revoke(id: string, actor: StaffPrincipal): Promise<SaleApprovalDelegation> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Delegation not found');
    const delegation = fromDoc<SaleApprovalDelegation>(snap);
    this.assertCanManage(actor, delegation.stationId);

    const now = nowIso();
    await this.col().doc(id).update({ revokedAt: now, revokedByUserId: actor.userId, updatedAt: now });
    return { ...delegation, revokedAt: now, revokedByUserId: actor.userId };
  }

  async listForStation(stationId: string): Promise<SaleApprovalDelegation[]> {
    const snap = await this.col().where('stationId', '==', stationId).get();
    return snap.docs.map((d) => fromDoc<SaleApprovalDelegation>(d)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  async getActiveForStation(stationId: string): Promise<SaleApprovalDelegation | null> {
    const delegations = await this.listForStation(stationId);
    const now = new Date();
    return (
      delegations.find(
        (d) => !d.revokedAt && new Date(d.startDate) <= now && now <= new Date(d.endDate),
      ) ?? null
    );
  }

  async isActiveDelegate(userId: string, stationId: string): Promise<boolean> {
    const active = await this.getActiveForStation(stationId);
    return active?.delegateUserId === userId;
  }

  /** The station (if any) a non-supervisor staff member currently holds an active delegation for. Scans all stations — fine at this app's scale (a handful of stations). */
  async findActiveDelegationStationForUser(userId: string): Promise<string | null> {
    const snap = await this.col().where('delegateUserId', '==', userId).get();
    const delegations = snap.docs.map((d) => fromDoc<SaleApprovalDelegation>(d));
    const now = new Date();
    const active = delegations.find((d) => !d.revokedAt && new Date(d.startDate) <= now && now <= new Date(d.endDate));
    return active?.stationId ?? null;
  }

  /** Minimal staff directory for the delegate picker — deliberately excludes email/other PII, so it doesn't need Permission.USERS_MANAGE to call. */
  async listEligibleStaff(): Promise<{ id: string; fullName: string; role: string }[]> {
    const users = await this.users.list();
    return users
      .filter((u) => u.status === UserStatus.ACTIVE)
      .map((u) => ({ id: u.id, fullName: u.fullName, role: u.role }));
  }
}
