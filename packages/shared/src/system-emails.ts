import type { BaseDoc } from './types.js';

/**
 * Every email the system sends on its own (not the user-composed "Send
 * email" report actions, whose recipients the sender types in). Each one
 * goes to an automatic set of recipients worked out from users' roles at
 * send time; Admin/Super Admin can add extra To/CC addresses per type on
 * the Email recipients settings page, which are added on top — they never
 * replace the automatic ones.
 */
export enum SystemEmailType {
  PRICE_PUBLISHED = 'price_published',
  PRICE_REMINDER = 'price_reminder',
  LEDGER_STATION_RELEASE_REMINDER = 'ledger_station_release_reminder',
  LEDGER_RTSM_RELEASE_REMINDER = 'ledger_rtsm_release_reminder',
  LEDGER_SUBMITTED = 'ledger_submitted',
  LEDGER_READY_TO_DISBURSE = 'ledger_ready_to_disburse',
  LEDGER_APPROVED = 'ledger_approved',
  LEDGER_REJECTED = 'ledger_rejected',
  CASHBACK_TREND_AUTO = 'cashback_trend_auto',
}

export interface SystemEmailDefinition {
  type: SystemEmailType;
  label: string;
  /** When the email goes out. */
  trigger: string;
  /** Plain-language description of who the system sends it to automatically. */
  automaticRule: string;
}

export const SYSTEM_EMAIL_DEFINITIONS: SystemEmailDefinition[] = [
  {
    type: SystemEmailType.PRICE_PUBLISHED,
    label: 'New fuel price published',
    trigger: 'A new PMS/AGO price is published for a station.',
    automaticRule: "Every active Admin, plus the Station Supervisor(s) of the station whose price changed.",
  },
  {
    type: SystemEmailType.PRICE_REMINDER,
    label: 'Monthly fuel price reminder',
    trigger: 'On the reminder day set on the Prices page.',
    automaticRule: 'The reminder recipients set on the Prices page.',
  },
  {
    type: SystemEmailType.LEDGER_STATION_RELEASE_REMINDER,
    label: 'Station release reminder',
    trigger: "1st and 2nd of the month, for each station that hasn't released last month's sales.",
    automaticRule: "The station's active Station Supervisor(s), with every active Admin in CC.",
  },
  {
    type: SystemEmailType.LEDGER_RTSM_RELEASE_REMINDER,
    label: 'Ledger release-for-approval reminder',
    trigger: "1st and 2nd of the month, while last month's ledger hasn't been released for approval.",
    automaticRule: 'Every active RTSM, with every active Admin in CC.',
  },
  {
    type: SystemEmailType.LEDGER_SUBMITTED,
    label: 'Ledger awaiting approval',
    trigger: "The month's cashback ledger is released for approval.",
    automaticRule: 'Every Finance Approver.',
  },
  {
    type: SystemEmailType.LEDGER_READY_TO_DISBURSE,
    label: 'Ledger approved — payment file',
    trigger: 'A ledger is approved. Includes the combined payment file.',
    automaticRule: 'Every Finance Disburser.',
  },
  {
    type: SystemEmailType.LEDGER_APPROVED,
    label: 'Ledger approved — releaser notice',
    trigger: 'A ledger is approved.',
    automaticRule: 'The person who released the ledger for approval.',
  },
  {
    type: SystemEmailType.LEDGER_REJECTED,
    label: 'Ledger rejected',
    trigger: 'A ledger is rejected. Includes the reason.',
    automaticRule: 'The person who released the ledger for approval.',
  },
  {
    type: SystemEmailType.CASHBACK_TREND_AUTO,
    label: 'Paid-out cashback trend report',
    trigger: "A month's disbursement completes for every station.",
    automaticRule: 'The automatic recipients set under the paid-out cashback trend on the Reports page.',
  },
];

export interface EmailRecipientList {
  to: string[];
  cc: string[];
}

/** Firestore singleton holding the extra recipients per email type. */
export interface EmailRecipientSettings extends BaseDoc {
  byType: Partial<Record<SystemEmailType, EmailRecipientList>>;
}

export interface AutomaticEmailRecipient {
  email: string;
  name?: string;
  /** Narrows when this person actually gets it, e.g. "Only for Kisumu 1". */
  note?: string;
}

/** One row of the Email recipients settings page. */
export interface SystemEmailRecipientsView extends SystemEmailDefinition {
  /** Who the system would send to right now, worked out from current users and settings. */
  automatic: { to: AutomaticEmailRecipient[]; cc: AutomaticEmailRecipient[] };
  /** Recipients added on the settings page, on top of the automatic ones. */
  extra: EmailRecipientList;
}
