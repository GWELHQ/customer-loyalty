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
  permissions: Permission[];
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

  async getRoleDefinition(key: string): Promise<RoleDefinition> {
    const snap = await this.col().doc(key).get();
    if (snap.exists) {
      const data = snap.data() as RoleDefinitionRecord;
      return {
        key,
        displayName: data.displayName,
        description: data.description,
        permissions: data.permissions,
        isSystem: data.isSystem,
      };
    }
    const staticDefinition = SYSTEM_ROLE_DEFINITIONS[key as Role];
    if (!staticDefinition) throw new NotFoundException(`Unknown role "${key}"`);
    return staticDefinition;
  }

  async listRoles(): Promise<RoleDefinition[]> {
    const snap = await this.col().get();
    const overrides = new Map<string, RoleDefinition>();
    for (const doc of snap.docs) {
      const data = doc.data() as RoleDefinitionRecord;
      overrides.set(doc.id, {
        key: doc.id,
        displayName: data.displayName,
        description: data.description,
        permissions: data.permissions,
        isSystem: data.isSystem,
      });
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
    const record: RoleDefinitionRecord = {
      displayName: dto.displayName,
      description: dto.description,
      permissions: dto.permissions,
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

    // The admin role must always retain RBAC_MANAGE — otherwise an Admin
    // could accidentally lock every Admin (including themselves) out of
    // role management with no way back in short of a manual Firestore edit.
    if (key === Role.ADMIN && !nextPermissions.includes(Permission.RBAC_MANAGE)) {
      throw new BadRequestException(
        'The admin role must always retain rbac:manage — this would lock out all role management.',
      );
    }

    const existingSnap = await this.col().doc(key).get();
    const now = nowIso();
    const record: RoleDefinitionRecord = {
      displayName: dto.displayName ?? current.displayName,
      description: dto.description ?? current.description,
      permissions: nextPermissions,
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
