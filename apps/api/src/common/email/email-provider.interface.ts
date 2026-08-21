export interface EmailSendResult {
  success: boolean;
  errorReason?: string;
}

/** Adapter boundary for the email gateway. Swap MockEmailProvider for a real one (e.g. Microsoft Graph) in prod. */
export interface EmailProvider {
  readonly name: string;
  send(to: string[], subject: string, body: string): Promise<EmailSendResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
