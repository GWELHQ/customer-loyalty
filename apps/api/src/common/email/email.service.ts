import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.interface';
import { renderEmailHtml, titleCaseSubject, type RenderEmailOptions } from './render-email';

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  /**
   * Fire-and-forget — an email failing to send must never break the
   * workflow that triggered it (matches the SMS service's philosophy).
   *
   * Wraps every system email in the shared branded HTML layout so emails
   * are styled consistently with the web app, rather than each call site
   * building its own raw string.
   */
  async send(to: string[], subject: string, options: RenderEmailOptions): Promise<void> {
    if (to.length === 0) return;
    const titledSubject = titleCaseSubject(subject);
    const html = renderEmailHtml(options);
    try {
      const result = await this.provider.send(to, titledSubject, html);
      if (!result.success) {
        this.logger.warn(`Email "${titledSubject}" to ${to.join(', ')} failed: ${result.errorReason}`);
      }
    } catch (err) {
      this.logger.error(`Email "${titledSubject}" to ${to.join(', ')} threw`, err instanceof Error ? err.stack : err);
    }
  }
}
