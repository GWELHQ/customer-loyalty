import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type { EmailProvider, EmailSendResult } from './email-provider.interface';

interface GraphTokenResponse {
  access_token?: string;
  expires_in?: number;
  error_description?: string;
}

/**
 * Live email adapter using Microsoft Graph's application-permission
 * sendMail — a separate app registration (client credentials, Mail.Send
 * application permission, admin-consented) from the SPA's public-client
 * login flow, since sending mail server-side requires app-only auth.
 */
@Injectable()
export class MicrosoftGraphEmailProvider implements EmailProvider {
  readonly name = 'microsoft-graph';
  private readonly logger = new Logger('MicrosoftGraphEmailProvider');
  private readonly config: AppConfig['email']['microsoftGraph'];
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.config = configService.get('email', { infer: true }).microsoftGraph;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) {
      return this.cachedToken.value;
    }
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const res = await fetch(`https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as GraphTokenResponse;
    if (!res.ok || !json.access_token) {
      throw new Error(json.error_description ?? `HTTP ${res.status} acquiring a Graph token`);
    }
    this.cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  async send(to: string[], subject: string, body: string): Promise<EmailSendResult> {
    try {
      const token = await this.getAccessToken();
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.senderAddress)}/sendMail`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: 'Text', content: body },
              toRecipients: to.map((address) => ({ emailAddress: { address } })),
            },
            saveToSentItems: false,
          }),
        },
      );
      // Graph's sendMail returns 202 Accepted with an empty body on success.
      if (res.status === 202) return { success: true };
      const text = await res.text();
      this.logger.warn(`Email to ${to.join(', ')} failed: HTTP ${res.status} ${text}`);
      return { success: false, errorReason: `HTTP ${res.status}: ${text}` };
    } catch (err) {
      const errorReason = err instanceof Error ? err.message : 'Unknown error sending via Microsoft Graph';
      this.logger.warn(`Email to ${to.join(', ')} failed: ${errorReason}`);
      return { success: false, errorReason };
    }
  }
}
