import { Injectable, Logger } from '@nestjs/common';
import type { EmailProvider, SendEmailInput, EmailSendResult } from './email-provider.interface';

/** Development/demo email adapter: logs the message instead of sending it. */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockEmailProvider');

  async send({ to, cc, replyTo, subject, body, attachments }: SendEmailInput): Promise<EmailSendResult> {
    const extras = [
      cc?.length ? `cc=${cc.join(', ')}` : null,
      replyTo ? `replyTo=${replyTo}` : null,
      attachments?.length ? `attachments=${attachments.map((a) => a.filename).join(', ')}` : null,
    ].filter(Boolean);
    this.logger.log(`[MOCK EMAIL] -> ${to.join(', ')}${extras.length ? ` (${extras.join('; ')})` : ''} | ${subject}\n${body}`);
    return { success: true };
  }
}
