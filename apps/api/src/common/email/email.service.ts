import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailAttachment, type EmailProvider, type EmailSendResult } from './email-provider.interface';
import { renderEmailHtml, titleCaseSubject, type RenderEmailOptions } from './render-email';

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  /**
   * Wraps every system email in the shared branded HTML layout so emails
   * are styled consistently with the web app, rather than each call site
   * building its own raw string. Never throws — a failure is reported
   * back via the returned result (existing call sites all discard it,
   * matching the original fire-and-forget behavior; a caller that needs
   * to tell the user whether the send worked, like a user-triggered
   * "send report" action, can check `.success`).
   */
  async send(
    to: string[],
    subject: string,
    options: RenderEmailOptions,
    extra?: { cc?: string[]; replyTo?: string; attachments?: EmailAttachment[] },
  ): Promise<EmailSendResult> {
    if (to.length === 0) return { success: false, errorReason: 'No recipients' };
    const titledSubject = titleCaseSubject(subject);
    const html = renderEmailHtml(options);
    try {
      const result = await this.provider.send({
        to,
        cc: extra?.cc,
        replyTo: extra?.replyTo,
        subject: titledSubject,
        body: html,
        attachments: extra?.attachments,
      });
      if (!result.success) {
        this.logger.warn(`Email "${titledSubject}" to ${to.join(', ')} failed: ${result.errorReason}`);
      }
      return result;
    } catch (err) {
      const errorReason = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Email "${titledSubject}" to ${to.join(', ')} threw`, err instanceof Error ? err.stack : err);
      return { success: false, errorReason };
    }
  }
}
