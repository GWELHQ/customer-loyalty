import { Injectable, Logger } from '@nestjs/common';
import type { SmsProvider, SmsSendResult } from './sms-provider.interface';

/** Development/demo SMS adapter: logs the message instead of sending it. */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockSmsProvider');

  async send(toPhone: string, message: string): Promise<SmsSendResult> {
    this.logger.log(`[MOCK SMS] -> ${toPhone}: ${message}`);
    return { success: true, providerResponse: 'mock-accepted' };
  }
}
