export interface EmailSendResult {
  success: boolean;
  errorReason?: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  contentBytes: Buffer;
  /** Set to embed the file in the HTML body via `<img src="cid:...">` instead of showing it as a download. */
  inlineContentId?: string;
}

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
}

/** Adapter boundary for the email gateway. Swap MockEmailProvider for a real one (e.g. Microsoft Graph) in prod. */
export interface EmailProvider {
  readonly name: string;
  send(input: SendEmailInput): Promise<EmailSendResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
