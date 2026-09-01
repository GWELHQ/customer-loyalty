import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, SignJWT } from 'jose';
import type { AppConfig } from '../../config/configuration';
import type { AttendantPrincipal, StaffPrincipal } from '../types/principal';

type StaffAccessClaims = { typ: 'staff_access' } & StaffPrincipal;
type StaffRefreshClaims = { typ: 'staff_refresh'; userId: string };
type AttendantAccessClaims = { typ: 'attendant_access' } & AttendantPrincipal;
type AttendantRefreshClaims = { typ: 'attendant_refresh'; attendantId: string };

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

  /**
   * Long-lived (default 30d, `ATTENDANT_REFRESH_JWT_TTL`) alongside the
   * short-lived attendant access token — lets a device that recorded sales
   * offline silently mint a fresh access token and flush its queue once
   * connectivity returns, without a PIN re-entry, even with nobody logged
   * in at that moment. See handover.md 2026-09-01 for the offline-sync
   * design this exists for.
   */
  async signAttendantRefreshToken(attendantId: string): Promise<string> {
    return new SignJWT({ attendantId, typ: 'attendant_refresh' } satisfies AttendantRefreshClaims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.config.get('jwt').attendantRefreshTtl)
      .sign(this.refreshSecret());
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

  async verifyAttendantRefreshToken(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.refreshSecret());
      if (payload.typ !== 'attendant_refresh' || typeof payload.attendantId !== 'string') {
        throw new UnauthorizedException('Invalid refresh token');
      }
      return payload.attendantId;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
