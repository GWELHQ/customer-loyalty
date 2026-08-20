import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, SignJWT } from 'jose';
import type { AppConfig } from '../../config/configuration';
import type { AttendantPrincipal, StaffPrincipal } from '../types/principal';

type StaffAccessClaims = { typ: 'staff_access' } & StaffPrincipal;
type StaffRefreshClaims = { typ: 'staff_refresh'; userId: string };
type AttendantAccessClaims = { typ: 'attendant_access' } & AttendantPrincipal;

/**
 * Issues and verifies the app's own session tokens (JWTs signed with HS256
 * secrets from Secret Manager in prod). This is deliberately separate from
 * Microsoft's tokens: once a Microsoft sign-in is validated and the user is
 * matched/authorized against Firestore, we mint our own short-lived session
 * — the app never re-validates a Microsoft token on every request.
 */
@Injectable()
export class TokenService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private accessSecret() {
    return new TextEncoder().encode(this.config.get('jwt').accessSecret);
  }
  private refreshSecret() {
    return new TextEncoder().encode(this.config.get('jwt').refreshSecret);
  }

  async signStaffAccessToken(principal: StaffPrincipal): Promise<string> {
    return new SignJWT({ ...principal, typ: 'staff_access' } satisfies StaffAccessClaims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.config.get('jwt').accessTtl)
      .sign(this.accessSecret());
  }

  async signStaffRefreshToken(userId: string): Promise<string> {
    return new SignJWT({ userId, typ: 'staff_refresh' } satisfies StaffRefreshClaims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.config.get('jwt').refreshTtl)
      .sign(this.refreshSecret());
  }

  async signAttendantAccessToken(principal: AttendantPrincipal): Promise<string> {
    return new SignJWT({ ...principal, typ: 'attendant_access' } satisfies AttendantAccessClaims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.config.get('jwt').attendantTtl)
      .sign(this.accessSecret());
  }

  async verifyAccessToken(token: string): Promise<StaffPrincipal | AttendantPrincipal> {
    try {
      const { payload } = await jwtVerify(token, this.accessSecret());
      if (payload.typ === 'staff_access') {
        const { typ: _typ, iat: _iat, exp: _exp, ...principal } = payload as unknown as StaffAccessClaims &
          Record<string, unknown>;
        return principal as StaffPrincipal;
      }
      if (payload.typ === 'attendant_access') {
        const { typ: _typ, iat: _iat, exp: _exp, ...principal } = payload as unknown as AttendantAccessClaims &
          Record<string, unknown>;
        return principal as AttendantPrincipal;
      }
      throw new UnauthorizedException('Unrecognized token type');
    } catch {
      throw new UnauthorizedException('Invalid or expired session token');
    }
  }

  async verifyStaffRefreshToken(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.refreshSecret());
      if (payload.typ !== 'staff_refresh' || typeof payload.userId !== 'string') {
        throw new UnauthorizedException('Invalid refresh token');
      }
      return payload.userId;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
