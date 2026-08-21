import { Injectable, Logger } from '@nestjs/common';
import type { EmailProvider, EmailSendResult } from './email-provider.interface';

/** Development/demo email adapter: logs the message instead of sending it. */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockEmailProvider');

  async send(to: string[], subject: string, body: string): Promise<EmailSendResult> {
    this.logger.log(`[MOCK EMAIL] -> ${to.join(', ')} | ${subject}\n${body}`);
    return { success: true };
  }
}
