import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SystemEmailType } from '@loyalty/shared';
import { EmailRecipientSettingsService, normalizeEmails } from './email-recipient-settings.service';
import { EMAIL_PROVIDER, type EmailAttachment, type EmailProvider, type EmailSendResult } from './email-provider.interface';
import { renderEmailHtml, titleCaseSubject, type RenderEmailOptions } from './render-email';

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly recipientSettings: EmailRecipientSettingsService,
  ) {}

  /**
   * Wraps every system email in the shared branded HTML layout so emails
   * are styled consistently with the web app, rather than each call site
   * building its own raw string. Never throws — a failure is reported
   * back via the returned result (existing call sites all discard it,
   * matching the original fire-and-forget behavior; a caller that needs
   * to tell the user whether the send worked, like a user-triggered
   * "send report" action, can check `.success`).
   *
   * Passing `type` marks this as a system email: the extra To/CC
   * recipients configured for that type on the Email recipients settings
   * page are added to the automatic ones given here. A system email still
   * goes out to the extras alone when nobody is automatically due it.
   */
  async send(
    to: string[],
    subject: string,
    options: RenderEmailOptions,
    extra?: { cc?: string[]; replyTo?: string; attachments?: EmailAttachment[]; type?: SystemEmailType },
  ): Promise<EmailSendResult> {
    let cc = extra?.cc;
    if (extra?.type) {
      const configured = await this.configuredExtras(extra.type);
      to = normalizeEmails([...to, ...configured.to]);
      cc = normalizeEmails([...(cc ?? []), ...configured.cc]).filter((e) => !to.includes(e));
    }
    if (to.length === 0) return { success: false, errorReason: 'No recipients' };
    const titledSubject = titleCaseSubject(subject);
    const html = renderEmailHtml(options);
    try {
      const result = await this.provider.send({
        to,
        cc,
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

  /** A settings read failure must not stop the automatic recipients getting the email. */
  private async configuredExtras(type: SystemEmailType): Promise<{ to: string[]; cc: string[] }> {
    try {
      return await this.recipientSettings.extrasFor(type);
    } catch (err) {
      this.logger.error(`Could not load extra recipients for "${type}" — sending to the automatic ones only`, err instanceof Error ? err.stack : err);
      return { to: [], cc: [] };
    }
  }
}
