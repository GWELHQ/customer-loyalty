import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, UserStatus } from '@loyalty/shared';
import { AttendantsService } from '../attendants/attendants.service';
import { AuditService } from '../common/audit/audit.service';
import { TokenService } from '../common/token/token.service';
import type { AttendantPrincipal, StaffPrincipal } from '../common/types/principal';
import type { AppConfig } from '../config/configuration';
import { UsersService } from '../users/users.service';
import { MicrosoftOidcService } from './microsoft-oidc.service';

export interface StaffSession {
  accessToken: string;
  refreshToken: string;
  user: StaffPrincipal;
}

export interface AttendantSession {
  accessToken: string;
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

    // Microsoft successfully authenticating the person is not enough — the
    // backend is the source of truth for whether they're allowed in at all.
    if (user.status !== UserStatus.ACTIVE) {
      await this.audit.record({
        actor: 'system',
        action: 'auth.microsoft_login_rejected_inactive',
        entityType: 'user',
        entityId: user.id,
        entityLabel: user.fullName,
      });
      throw new UnauthorizedException(
        'Your account is not yet active. Ask an Admin to activate it and assign your role.',
      );
    }

    const principal: StaffPrincipal = {
      kind: 'staff',
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      assignedStationId: user.assignedStationId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signStaffAccessToken(principal),
      this.tokens.signStaffRefreshToken(user.id),
    ]);

    await this.users.touchLastLogin(user.id);
    await this.audit.record({
      actor: principal,
      action: 'auth.microsoft_login',
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.fullName,
    });

    return { accessToken, refreshToken, user: principal };
  }

  async refreshStaffSession(refreshToken: string): Promise<StaffSession> {
    const userId = await this.tokens.verifyStaffRefreshToken(refreshToken);
    const user = await this.users.findById(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Session no longer valid');
    }

    const principal: StaffPrincipal = {
      kind: 'staff',
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      assignedStationId: user.assignedStationId,
    };

    const [accessToken, newRefreshToken] = await Promise.all([
      this.tokens.signStaffAccessToken(principal),
      this.tokens.signStaffRefreshToken(user.id),
    ]);

    return { accessToken, refreshToken: newRefreshToken, user: principal };
  }

  async loginAttendant(employeeId: string, pin: string): Promise<AttendantSession> {
    const attendant = await this.attendants.verifyCredentials(employeeId, pin);

    const principal: AttendantPrincipal = {
      kind: 'attendant',
      attendantId: attendant.id,
      employeeId: attendant.employeeId,
      fullName: attendant.fullName,
      role: Role.ATTENDANT,
      assignedStationId: attendant.assignedStationId,
    };

    const accessToken = await this.tokens.signAttendantAccessToken(principal);

    await this.audit.record({
      actor: principal,
      action: 'auth.attendant_login',
      entityType: 'attendant',
      entityId: attendant.id,
      entityLabel: attendant.fullName,
    });

    return { accessToken, attendant: principal };
  }
}
