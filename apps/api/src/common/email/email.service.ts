import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.interface';

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  /**
   * Fire-and-forget — an email failing to send must never break the
   * workflow that triggered it (matches the SMS service's philosophy).
   */
  async send(to: string[], subject: string, body: string): Promise<void> {
    if (to.length === 0) return;
    try {
      const result = await this.provider.send(to, subject, body);
      if (!result.success) {
        this.logger.warn(`Email "${subject}" to ${to.join(', ')} failed: ${result.errorReason}`);
      }
    } catch (err) {
      this.logger.error(`Email "${subject}" to ${to.join(', ')} threw`, err instanceof Error ? err.stack : err);
    }
  }
}
