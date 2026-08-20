export interface SmsSendResult {
  success: boolean;
  providerResponse?: string;
  errorReason?: string;
}

/** Adapter boundary for the SMS gateway. Swap MockSmsProvider for a real one (e.g. Africa's Talking) in prod. */
export interface SmsProvider {
  readonly name: string;
  send(toPhone: string, message: string): Promise<SmsSendResult>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
