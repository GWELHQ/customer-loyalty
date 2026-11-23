import { SystemEmailType } from '@loyalty/shared';
import type { EmailProvider, SendEmailInput } from './email-provider.interface';
import type { EmailRecipientSettingsService } from './email-recipient-settings.service';
import { EmailService } from './email.service';

function setup(extras: { to: string[]; cc: string[] } | Error) {
  const sent: SendEmailInput[] = [];
  const provider: EmailProvider = {
    name: 'test',
    send: async (input) => {
      sent.push(input);
      return { success: true };
    },
  };
  const settings = {
    extrasFor: async () => {
      if (extras instanceof Error) throw extras;
      return extras;
    },
  } as unknown as EmailRecipientSettingsService;
  return { service: new EmailService(provider, settings), sent };
}

const body = { title: 'Hello', bodyLines: ['Body'] };

describe('EmailService extra recipients', () => {
  it('adds the configured To/CC to a system email, without duplicates', async () => {
    const { service, sent } = setup({ to: ['extra@x.com', 'auto@x.com'], cc: ['cc@x.com', 'extra@x.com'] });
    await service.send(['Auto@x.com'], 'Subject', body, { cc: ['admin@x.com'], type: SystemEmailType.LEDGER_SUBMITTED });
    expect(sent[0]!.to).toEqual(['auto@x.com', 'extra@x.com']);
    expect(sent[0]!.cc).toEqual(['admin@x.com', 'cc@x.com']);
  });

  it('sends to the extras alone when nobody is automatically due the email', async () => {
    const { service, sent } = setup({ to: ['extra@x.com'], cc: [] });
    const result = await service.send([], 'Subject', body, { type: SystemEmailType.LEDGER_READY_TO_DISBURSE });
    expect(result.success).toBe(true);
    expect(sent[0]!.to).toEqual(['extra@x.com']);
  });

  it('still reports "No recipients" when there are neither automatic nor extra To recipients', async () => {
    const { service, sent } = setup({ to: [], cc: ['cc@x.com'] });
    const result = await service.send([], 'Subject', body, { type: SystemEmailType.PRICE_REMINDER });
    expect(result).toEqual({ success: false, errorReason: 'No recipients' });
    expect(sent).toHaveLength(0);
  });

  it('leaves user-composed emails (no type) untouched', async () => {
    const { service, sent } = setup({ to: ['extra@x.com'], cc: ['cc@x.com'] });
    await service.send(['Someone@x.com'], 'Subject', body, { cc: ['c@x.com'] });
    expect(sent[0]!.to).toEqual(['Someone@x.com']);
    expect(sent[0]!.cc).toEqual(['c@x.com']);
  });

  it('falls back to the automatic recipients if the settings cannot be read', async () => {
    const { service, sent } = setup(new Error('firestore down'));
    const result = await service.send(['auto@x.com'], 'Subject', body, { type: SystemEmailType.PRICE_PUBLISHED });
    expect(result.success).toBe(true);
    expect(sent[0]!.to).toEqual(['auto@x.com']);
  });
});
