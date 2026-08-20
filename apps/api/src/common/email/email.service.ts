import { Injectable, Logger } from '@nestjs/common';

/**
 * Minimal email adapter. Logs in dev/demo; swap the body of send() for a
 * real provider (e.g. SendGrid, SES) in production — nothing else in the
 * codebase needs to change since callers only depend on this interface.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  async send(to: string[], subject: string, body: string): Promise<void> {
    this.logger.log(`[MOCK EMAIL] -> ${to.join(', ')} | ${subject}\n${body}`);
  }
}
