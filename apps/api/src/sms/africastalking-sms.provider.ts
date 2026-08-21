import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import type { SmsProvider, SmsSendResult } from './sms-provider.interface';

interface AfricasTalkingRecipient {
  statusCode: number;
  number: string;
  status: string;
  cost?: string;
  messageId?: string;
}

interface AfricasTalkingResponse {
  SMSMessageData?: {
    Message: string;
    Recipients: AfricasTalkingRecipient[];
  };
}

/** Live SMS adapter for the Africa's Talking bulk messaging API. */
@Injectable()
export class AfricasTalkingSmsProvider implements SmsProvider {
  readonly name = 'africastalking';
  private readonly logger = new Logger('AfricasTalkingSmsProvider');
  private readonly config: AppConfig['sms']['africastalking'];

  constructor(configService: ConfigService<AppConfig, true>) {
    this.config = configService.get('sms', { infer: true }).africastalking;
  }

  async send(toPhone: string, message: string): Promise<SmsSendResult> {
    const body = new URLSearchParams({
      username: this.config.username,
      to: toPhone,
      message,
    });
    if (this.config.senderId) body.set('from', this.config.senderId);

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/version1/messaging`, {
        method: 'POST',
        headers: {
          apiKey: this.config.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
      });
    } catch (err) {
      const errorReason = err instanceof Error ? err.message : 'Network error calling Africa\'s Talking';
      this.logger.warn(`SMS to ${toPhone} failed: ${errorReason}`);
      return { success: false, errorReason };
    }

    const raw = await response.text();
    if (!response.ok) {
      this.logger.warn(`SMS to ${toPhone} failed: HTTP ${response.status} ${raw}`);
      return { success: false, errorReason: `HTTP ${response.status}: ${raw}`, providerResponse: raw };
    }

    let parsed: AfricasTalkingResponse;
    try {
      parsed = JSON.parse(raw) as AfricasTalkingResponse;
    } catch {
      return { success: false, errorReason: 'Unparseable response from Africa\'s Talking', providerResponse: raw };
    }

    const recipient = parsed.SMSMessageData?.Recipients?.[0];
    if (!recipient) {
      return { success: false, errorReason: parsed.SMSMessageData?.Message ?? 'No recipient in response', providerResponse: raw };
    }
    if (recipient.status !== 'Success') {
      this.logger.warn(`SMS to ${toPhone} rejected: ${recipient.status} (code ${recipient.statusCode})`);
      return { success: false, errorReason: `${recipient.status} (code ${recipient.statusCode})`, providerResponse: raw };
    }

    return { success: true, providerResponse: recipient.messageId ?? raw };
  }
}
