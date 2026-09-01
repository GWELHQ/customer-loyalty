import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, UserStatus, type Attendant } from '@loyalty/shared';
import { AttendantsService } from '../attendants/attendants.service';
import { AuditService } from '../common/audit/audit.service';
import { TokenService } from '../common/token/token.service';
import type { AttendantPrincipal, StaffPrincipal } from '../common/types/principal';
import type { AppConfig } from '../config/configuration';
import { RbacService } from '../rbac/rbac.service';
import { UsersService } from '../users/users.service';
import { MicrosoftOidcService } from './microsoft-oidc.service';

export interface StaffSession {
  accessToken: string;
  refreshToken: string;
  user: StaffPrincipal;
}

export interface AttendantSession {
  accessToken: string;
  refreshToken: string;
  attendant: AttendantPrincipal;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly microsoftOidc: MicrosoftOidcService,
    private readonly users: UsersService,
    private readonly attendants: AttendantsService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly rbac: RbacService,
  ) {}

  getMicrosoftClientConfig() {
    const { tenantId, clientId, redirectUri } = this.config.get('msEntra');
    return {
      tenantId,
      clientId,
      redirectUri,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      scopes: ['openid', 'profile', 'email'],
    };
  }

  async loginWithMicrosoft(idToken: string): Promise<StaffSession> {
    const claims = await this.microsoftOidc.verifyIdToken(idToken);

    const user = await this.users.findOrProvisionByEmail({
      email: claims.email,
      fullName: claims.name,
      microsoftOid: claims.oid,
    });

    // Microsoft successfully authenticating the person doesn't grant any
    // real access — a not-yet-activated (or deactivated) account still
    // gets a session, but PermissionsGuard rejects it on every
    // permission-gated route, so the web app just shows a "waiting for an
    // Admin" screen instead of a real dashboard. This lets an Admin's later
    // activation reach the already-open tab via the same realtime-refresh
    // path as any other role/status change, with no re-login needed.
    const permissions = await this.rbac.getPermissionsForRole(user.role);
    const principal: StaffPrincipal = {
      kind: 'staff',
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      permissions,
      assignedStationId: user.assignedStationId,
      status: user.status,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signStaffAccessToken(principal),
      this.tokens.signStaffRefreshToken(user.id),
    ]);

    await this.users.touchLastLogin(user.id);
    await this.audit.record({
      actor: principal,
      action: user.status === UserStatus.ACTIVE ? 'auth.microsoft_login' : 'auth.microsoft_login_pending_activation',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.fullName,
    });

    return { accessToken, refreshToken, user: principal };
  }

  async refreshStaffSession(refreshToken: string): Promise<StaffSession> {
    const userId = await this.tokens.verifyStaffRefreshToken(refreshToken);
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Session no longer valid');
    }

    const permissions = await this.rbac.getPermissionsForRole(user.role);
    const principal: StaffPrincipal = {
      kind: 'staff',
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      permissions,
      assignedStationId: user.assignedStationId,
      status: user.status,
    };

    const [accessToken, newRefreshToken] = await Promise.all([
      this.tokens.signStaffAccessToken(principal),
      this.tokens.signStaffRefreshToken(user.id),
    ]);

    return { accessToken, refreshToken: newRefreshToken, user: principal };
  }

  async loginAttendant(employeeId: string, pin: string): Promise<AttendantSession> {
    const attendant = await this.attendants.verifyCredentials(employeeId, pin);
    return this.issueAttendantSession(attendant, 'auth.attendant_login');
  }

  /** Badge-tap login — no PIN, see AttendantsService.verifyByNfcTag for the security tradeoff this accepts. */
  async loginAttendantByNfcTag(tagId: string): Promise<AttendantSession> {
    const attendant = await this.attendants.verifyByNfcTag(tagId);
    return this.issueAttendantSession(attendant, 'auth.attendant_nfc_login');
  }

  /**
   * Silently exchanges a still-valid attendant refresh token for a fresh
   * access + refresh pair — no PIN, no audit action distinct from a normal
   * login (this is meant to be invisible to the attendant, typically fired
   * by the app in the background right before flushing an offline sales
   * queue). Rotates the refresh token on every use, same as staff.
   */
  async refreshAttendantSession(refreshToken: string): Promise<AttendantSession> {
    const attendantId = await this.tokens.verifyAttendantRefreshToken(refreshToken);
    const attendant = await this.attendants.findById(attendantId);
    if (!attendant || attendant.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Session no longer valid');
    }
    return this.issueAttendantSession(attendant);
  }

  private async issueAttendantSession(
    attendant: Attendant,
    auditAction?: 'auth.attendant_login' | 'auth.attendant_nfc_login',
  ): Promise<AttendantSession> {
    const principal: AttendantPrincipal = {
      kind: 'attendant',
      attendantId: attendant.id,
      employeeId: attendant.employeeId,
      fullName: attendant.fullName,
      role: Role.ATTENDANT,
      assignedStationId: attendant.assignedStationId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signAttendantAccessToken(principal),
      this.tokens.signAttendantRefreshToken(attendant.id),
    ]);

    if (auditAction) {
      await this.audit.record({
        actor: principal,
        action: auditAction,
        entityType: 'attendant',
        entityId: attendant.id,
        entityLabel: attendant.fullName,
      });
    }

    return { accessToken, refreshToken, attendant: principal };
  }
}
