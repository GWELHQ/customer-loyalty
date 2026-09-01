import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus, type User } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { ChangeEventsService } from '../events/change-events.service';
import { RbacService } from '../rbac/rbac.service';

const COLLECTION = 'users';

@Injectable()
export class UsersService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
    private readonly rbac: RbacService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async findById(id: string): Promise<User | null> {
    const snap = await this.col().doc(id).get();
    return snap.exists ? fromDoc<User>(snap) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const snap = await this.col().where('email', '==', email.toLowerCase()).limit(1).get();
    return snap.empty ? null : fromDoc<User>(snap.docs[0]!);
  }

  async list(): Promise<User[]> {
    const snap = await this.col().orderBy('fullName').get();
    return snap.docs.map((d) => fromDoc<User>(d));
  }

  /**
   * Matches an already-Microsoft-verified email against Firestore, or
   * provisions a new user record on first login. The backend — not
   * Microsoft's claims — remains the source of truth for role, active
   * status, and station assignment from this point on.
   */
  async findOrProvisionByEmail(params: {
    email: string;
    fullName: string;
    microsoftOid: string;
  }): Promise<User> {
    const existing = await this.findByEmail(params.email);
    if (existing) {
      if (!existing.microsoftOid) {
        await this.col().doc(existing.id).update({ microsoftOid: params.microsoftOid });
      }
      return existing;
    }

    // First-time Microsoft sign-in with no matching Firestore user: create
    // an inactive placeholder so an Admin can review and assign a role.
    // They are rejected at login until an Admin activates them (see
    // AuthService.loginWithMicrosoft). Defaults to the most restrictive
    // real staff role (station_supervisor) rather than RTSM — an Admin
    // must still explicitly assign the actual role and, for
    // station_supervisor, a station before activating.
    const now = nowIso();
    const doc: Omit<User, 'id'> = {
      fullName: params.fullName,
      email: params.email.toLowerCase(),
      role: Role.STATION_SUPERVISOR,
      status: UserStatus.INACTIVE,
      microsoftOid: params.microsoftOid,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: ref.id };
  }

  async create(input: {
    fullName: string;
    email: string;
    role: string;
    assignedStationId?: string;
  }): Promise<User> {
    await this.assertRoleExists(input.role);
    this.assertStationAssignmentRule(input.role, input.assignedStationId);
    const existing = await this.findByEmail(input.email);
    if (existing) throw new BadRequestException('A user with this email already exists');

    const now = nowIso();
    const doc: Omit<User, 'id'> = {
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      role: input.role,
      status: UserStatus.ACTIVE,
      assignedStationId: input.assignedStationId,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: ref.id };
  }

  async update(
    id: string,
    input: Partial<Pick<User, 'fullName' | 'role' | 'assignedStationId'>>,
  ): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');

    const nextRole = input.role ?? user.role;
    if (input.role) await this.assertRoleExists(input.role);
    const nextStation = 'assignedStationId' in input ? input.assignedStationId : user.assignedStationId;
    this.assertStationAssignmentRule(nextRole, nextStation);

    await this.col()
      .doc(id)
      .update({ ...input, updatedAt: nowIso() });
    // entityId lets the affected user's own already-open session notice
    // its role/station changed and silently refresh, instead of running
    // on stale JWT claims until they happen to sign out and back in.
    this.changeEvents.emit(COLLECTION, id);
    return (await this.findById(id))!;
  }

  async setStatus(id: string, status: UserStatus): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    await this.col().doc(id).update({ status, updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION, id);
    return (await this.findById(id))!;
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.col().doc(id).update({ lastLoginAt: nowIso() });
  }

  /**
   * A user's role must be a real one — a built-in Role or a custom role
   * created via /rbac/roles — not an arbitrary unknown string. Doubles as
   * the DTO-level `@IsEnum(Role)` check this replaced, now that role keys
   * aren't a fixed enum.
   */
  private async assertRoleExists(role: string): Promise<void> {
    try {
      await this.rbac.getRoleDefinition(role);
    } catch {
      throw new BadRequestException(`Unknown role "${role}"`);
    }
  }

  /**
   * Enforces the critical station rule: a station_supervisor must have
   * exactly one assigned station; every other role must have none. This is
   * enforced here (the write path) in addition to API-level DTO validation.
   * Deliberately keyed off the literal built-in Role.STATION_SUPERVISOR —
   * a custom role doesn't get automatic station-scoping (see the RBAC plan's
   * documented scope boundary).
   */
  private assertStationAssignmentRule(role: string, assignedStationId?: string): void {
    if (role === Role.STATION_SUPERVISOR && !assignedStationId) {
      throw new BadRequestException('station_supervisor requires exactly one assignedStationId');
    }
    if (role !== Role.STATION_SUPERVISOR && assignedStationId) {
      throw new BadRequestException('Only station_supervisor may have an assignedStationId');
    }
  }
}
