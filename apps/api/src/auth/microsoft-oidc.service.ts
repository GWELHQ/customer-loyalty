import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppConfig } from '../config/configuration';

export interface MicrosoftIdTokenClaims {
  oid: string;
  email: string;
  name: string;
  preferred_username?: string;
}

/**
 * Validates Microsoft Entra ID id_tokens against Microsoft's published
 * JWKS for our tenant. This is the only place that trusts Microsoft's
 * claims — role/active-status/station assignment are looked up from
 * Firestore afterward, never taken from the token itself.
 */
@Injectable()
export class MicrosoftOidcService {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private getJwks() {
    if (!this.jwks) {
      const tenantId = this.config.get('msEntra').tenantId;
      this.jwks = createRemoteJWKSet(
        new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
      );
    }
    return this.jwks;
  }

  async verifyIdToken(idToken: string): Promise<MicrosoftIdTokenClaims> {
    const { tenantId, clientId } = this.config.get('msEntra');
    try {
      const { payload } = await jwtVerify(idToken, this.getJwks(), {
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        audience: clientId,
      });

      const email = (payload.email ?? payload.preferred_username) as string | undefined;
      if (!email || typeof payload.oid !== 'string') {
        throw new UnauthorizedException('Microsoft token is missing required claims');
      }

      return {
        oid: payload.oid,
        email: email.toLowerCase(),
        name: (payload.name as string | undefined) ?? email,
        preferred_username: payload.preferred_username as string | undefined,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid Microsoft identity token');
    }
  }
}
