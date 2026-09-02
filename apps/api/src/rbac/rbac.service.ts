import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Permission, Role, SYSTEM_ROLE_DEFINITIONS, type RoleDefinition } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { nowIso } from '../common/firestore/helpers';
import { ChangeEventsService } from '../events/change-events.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const COLLECTION = 'roleDefinitions';

interface RoleDefinitionRecord {
  displayName: string;
  description: string;
  /**
   * Stored as a DIFF against the live `SYSTEM_ROLE_DEFINITIONS[key]`
   * default, not a frozen snapshot — see `effectivePermissions()` below
   * for why. For a custom (non-system) role there is no code default to
   * diff against, so `addedPermissions` is simply its whole permission
   * set and `removedPermissions` is always empty.
   */
  addedPermissions: Permission[];
  removedPermissions: Permission[];
  isSystem: boolean;
  updatedBy: string;
  updatedAt: string;
  createdBy?: string;
  createdAt?: string;
}

/**
 * Dynamic role/permission catalogue. A Firestore `roleDefinitions` doc
 * (id = role key) overrides or adds to the static `SYSTEM_ROLE_DEFINITIONS`
 * table — every read merges the two, so the 9 built-in roles keep working
 * identically with zero Firestore docs present. This is the single source
 * both `AuthService` (embeds the resolved permission list into the JWT at
 * session-mint time) and the web app's roles catalogue read from.
 *
 * The override is stored as an added/removed DIFF against the *current*
 * code default, recomputed on every read — not a frozen permissions
 * snapshot. A snapshot would silently stop tracking new permissions a
 * later code change grants that role: once any admin saved an edit to a
 * system role (even an unrelated field), the snapshot would freeze that
 * role's permissions at whatever the code defaults were that moment, and
 * every subsequent code-level grant to that role would never reach it —
 * exactly the bug that hit Station Supervisor and RTSM when the shift-
 * management permissions shipped after their roles had been edited once.
 * Diffing against the live default instead means a new code-level grant
 * always flows through automatically (it's simply not in `removed`),
 * while an admin's intentional customizations (added extras, removed
 * defaults) are preserved exactly.
 */
@Injectable()
export class RbacService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  private codeDefaultPermissions(key: string): Permission[] {
    return SYSTEM_ROLE_DEFINITIONS[key as Role]?.permissions ?? [];
  }

  private effectivePermissions(key: string, record: RoleDefinitionRecord): Permission[] {
    const removed = new Set(record.removedPermissions);
    const kept = this.codeDefaultPermissions(key).filter((p) => !removed.has(p));
    const extra = record.addedPermissions.filter((p) => !kept.includes(p));
    return [...kept, ...extra];
  }

  private toRoleDefinition(key: string, data: RoleDefinitionRecord): RoleDefinition {
    return {
      key,
      displayName: data.displayName,
      description: data.description,
      permissions: this.effectivePermissions(key, data),
      isSystem: data.isSystem,
    };
  }

  async getRoleDefinition(key: string): Promise<RoleDefinition> {
    const snap = await this.col().doc(key).get();
    if (snap.exists) {
      return this.toRoleDefinition(key, snap.data() as RoleDefinitionRecord);
    }
    const staticDefinition = SYSTEM_ROLE_DEFINITIONS[key as Role];
    if (!staticDefinition) throw new NotFoundException(`Unknown role "${key}"`);
    return staticDefinition;
  }

  async listRoles(): Promise<RoleDefinition[]> {
    const snap = await this.col().get();
    const overrides = new Map<string, RoleDefinition>();
    for (const doc of snap.docs) {
      overrides.set(doc.id, this.toRoleDefinition(doc.id, doc.data() as RoleDefinitionRecord));
    }
    const merged = new Map<string, RoleDefinition>();
    for (const [key, definition] of Object.entries(SYSTEM_ROLE_DEFINITIONS)) {
      merged.set(key, overrides.get(key) ?? definition);
    }
    for (const [key, definition] of overrides) {
      if (!merged.has(key)) merged.set(key, definition);
    }
    return [...merged.values()];
  }

  listPermissions(): Permission[] {
    return Object.values(Permission);
  }

  /** What `AuthService` calls at login/token-refresh time to embed a fresh permission list in the session. */
  async getPermissionsForRole(key: string): Promise<Permission[]> {
    return (await this.getRoleDefinition(key)).permissions;
  }

  async roleHasPermission(key: string, permission: Permission): Promise<boolean> {
    return (await this.getPermissionsForRole(key)).includes(permission);
  }

  private validatePermissions(permissions: string[]): void {
    const invalid = permissions.filter((p) => !(Object.values(Permission) as string[]).includes(p));
    if (invalid.length > 0) {
      throw new BadRequestException(`Unknown permission key(s): ${invalid.join(', ')}`);
    }
  }

  async createRole(dto: CreateRoleDto, actorUserId: string): Promise<RoleDefinition> {
    this.validatePermissions(dto.permissions);
    if ((Object.values(Role) as string[]).includes(dto.key)) {
      throw new ConflictException(`"${dto.key}" collides with a built-in system role key`);
    }
    const existing = await this.col().doc(dto.key).get();
    if (existing.exists) {
      throw new ConflictException(`A role with key "${dto.key}" already exists`);
    }
    const now = nowIso();
    // A brand-new custom role has no code default to diff against, so its
    // whole submitted permission set is "added" — diffPermissions([], ...)
    // degenerates to exactly that.
    const { addedPermissions, removedPermissions } = diffPermissions([], dto.permissions);
    const record: RoleDefinitionRecord = {
      displayName: dto.displayName,
      description: dto.description,
      addedPermissions,
      removedPermissions,
      isSystem: false,
      createdBy: actorUserId,
      createdAt: now,
      updatedBy: actorUserId,
      updatedAt: now,
    };
    await this.col().doc(dto.key).set(record);
    this.changeEvents.emit(COLLECTION, dto.key);
    return this.getRoleDefinition(dto.key);
  }

  async updateRole(key: string, dto: UpdateRoleDto, actorUserId: string): Promise<RoleDefinition> {
    const current = await this.getRoleDefinition(key);
    const nextPermissions = dto.permissions ?? current.permissions;
    this.validatePermissions(nextPermissions);

    // Admin and Super Admin must always retain RBAC_MANAGE — otherwise
    // every holder of that role (including whoever's making this edit)
    // could get locked out of role management with no way back in short
    // of a manual Firestore edit.
    if ((key === Role.ADMIN || key === Role.SUPER_ADMIN) && !nextPermissions.includes(Permission.RBAC_MANAGE)) {
      throw new BadRequestException(
        `The ${key} role must always retain rbac:manage — this would lock out all role management.`,
      );
    }

    const existingSnap = await this.col().doc(key).get();
    const now = nowIso();
    // Re-diff against the *code* default (empty set for a custom role),
    // never against the previous override — so a permission this session
    // grants in code, on a role nobody has touched since, is never
    // recorded as "removed" just because it wasn't in the admin's
    // previously-submitted list.
    const { addedPermissions, removedPermissions } = diffPermissions(this.codeDefaultPermissions(key), nextPermissions);
    const record: RoleDefinitionRecord = {
      displayName: dto.displayName ?? current.displayName,
      description: dto.description ?? current.description,
      addedPermissions,
      removedPermissions,
      isSystem: current.isSystem,
      createdBy: existingSnap.exists ? (existingSnap.data() as RoleDefinitionRecord).createdBy : actorUserId,
      createdAt: existingSnap.exists ? (existingSnap.data() as RoleDefinitionRecord).createdAt : now,
      updatedBy: actorUserId,
      updatedAt: now,
    };
    await this.col().doc(key).set(record);
    this.changeEvents.emit(COLLECTION, key);
    return this.getRoleDefinition(key);
  }

  /**
   * Wipes a system role's Firestore override entirely, reverting its
   * effective permissions to whatever `SYSTEM_ROLE_DEFINITIONS` says in
   * code right now — Super Admin only (see RbacController), since this
   * discards any customization an Admin made from the Roles page. A
   * custom (non-system) role has no code default to revert to, so it's
   * simply not eligible.
   */
  async resetRoleToDefault(key: string): Promise<RoleDefinition> {
    const current = await this.getRoleDefinition(key);
    if (!current.isSystem) {
      throw new BadRequestException('Only a built-in system role can be reset to default — delete a custom role instead.');
    }
    await this.col().doc(key).delete();
    this.changeEvents.emit(COLLECTION, key);
    return this.getRoleDefinition(key);
  }

  async deleteRole(key: string): Promise<void> {
    const current = await this.getRoleDefinition(key);
    if (current.isSystem) {
      throw new BadRequestException('System roles cannot be deleted');
    }
    // Queried directly against Firestore rather than through UsersService,
    // to avoid a UsersModule <-> RbacModule circular import (UsersService
    // needs RbacService for role-existence validation on create/update).
    const assigned = await this.firestore.collection('users').where('role', '==', key).limit(1).get();
    if (!assigned.empty) {
      throw new ConflictException('This role has active users assigned to it — reassign them before deleting the role');
    }
    await this.col().doc(key).delete();
    this.changeEvents.emit(COLLECTION, key);
  }
}

/** Splits a desired permission set into what it adds/removes relative to a base set. */
function diffPermissions(
  base: Permission[],
  desired: Permission[],
): { addedPermissions: Permission[]; removedPermissions: Permission[] } {
  return {
    addedPermissions: desired.filter((p) => !base.includes(p)),
    removedPermissions: base.filter((p) => !desired.includes(p)),
  };
}
