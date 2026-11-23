import { Injectable } from '@nestjs/common';
import {
  Permission,
  Role,
  SYSTEM_EMAIL_DEFINITIONS,
  SystemEmailType,
  UserStatus,
  type AutomaticEmailRecipient,
  type SystemEmailRecipientsView,
  type User,
} from '@loyalty/shared';
import { CashbackTrendService } from '../cashback-trend/cashback-trend.service';
import { EmailRecipientSettingsService } from '../common/email/email-recipient-settings.service';
import { PriceRemindersService } from '../prices/price-reminders.service';
import { RbacService } from '../rbac/rbac.service';
import { StationsService } from '../stations/stations.service';
import { UsersService } from '../users/users.service';

type Automatic = SystemEmailRecipientsView['automatic'];

/**
 * Backs the Email recipients settings page: lists every system email with
 * who it goes to automatically (worked out the same way each sender does,
 * from current users and settings) and the extra recipients configured.
 * Keep each rule here in step with its sender (prices.controller,
 * cashback-ledgers.controller, jobs.controller, cashback-trend.service).
 */
@Injectable()
export class EmailRecipientsService {
  constructor(
    private readonly settings: EmailRecipientSettingsService,
    private readonly users: UsersService,
    private readonly stations: StationsService,
    private readonly rbac: RbacService,
    private readonly priceReminders: PriceRemindersService,
    private readonly cashbackTrend: CashbackTrendService,
  ) {}

  async list(): Promise<SystemEmailRecipientsView[]> {
    const [saved, automatic] = await Promise.all([this.settings.get(), this.resolveAutomatic()]);
    return SYSTEM_EMAIL_DEFINITIONS.map((definition) => ({
      ...definition,
      automatic: automatic[definition.type],
      extra: { to: saved.byType[definition.type]?.to ?? [], cc: saved.byType[definition.type]?.cc ?? [] },
    }));
  }

  update(type: SystemEmailType, input: { to: string[]; cc: string[] }) {
    return this.settings.update(type, input);
  }

  private async resolveAutomatic(): Promise<Record<SystemEmailType, Automatic>> {
    const [users, stations, reminder, trend] = await Promise.all([
      this.users.list(),
      this.stations.list(),
      this.priceReminders.get(),
      this.cashbackTrend.getSettings(),
    ]);
    const stationName = new Map(stations.map((s) => [s.id, s.name]));
    const active = users.filter((u) => u.status === UserStatus.ACTIVE);
    const person = (u: User, note?: string): AutomaticEmailRecipient => ({ email: u.email, name: u.fullName, ...(note ? { note } : {}) });
    const address = (email: string): AutomaticEmailRecipient => ({ email });
    const withRole = (list: User[], role: Role) => list.filter((u) => u.role === role);
    const supervisors = withRole(active, Role.STATION_SUPERVISOR).map((u) =>
      person(u, u.assignedStationId ? `Only for ${stationName.get(u.assignedStationId) ?? 'their station'}` : 'No station assigned'),
    );
    const admins = withRole(active, Role.ADMIN).map((u) => person(u));

    // Whoever released the ledger: anyone whose role can release it (RTSM,
    // Admin, Super Admin by default, plus custom roles granted it).
    const releaserRoles = new Set<string>();
    for (const role of new Set(users.map((u) => u.role))) {
      if (await this.rbac.roleHasPermission(role, Permission.LEDGERS_MANAGE)) releaserRoles.add(role);
    }
    const releasers = users
      .filter((u) => releaserRoles.has(u.role))
      .map((u) => person(u, 'Only if they released that ledger'));

    const none: AutomaticEmailRecipient[] = [];
    return {
      [SystemEmailType.PRICE_PUBLISHED]: { to: [...admins, ...supervisors], cc: none },
      [SystemEmailType.PRICE_REMINDER]: {
        to: reminder.enabled ? reminder.recipientEmails.map(address) : [],
        cc: none,
      },
      [SystemEmailType.LEDGER_STATION_RELEASE_REMINDER]: { to: supervisors, cc: admins },
      [SystemEmailType.LEDGER_RTSM_RELEASE_REMINDER]: { to: withRole(active, Role.RTSM).map((u) => person(u)), cc: admins },
      // The ledger workflow emails go to every user in the role, active or not, as the sender does.
      [SystemEmailType.LEDGER_SUBMITTED]: { to: withRole(users, Role.FINANCE_APPROVER).map((u) => person(u)), cc: none },
      [SystemEmailType.LEDGER_READY_TO_DISBURSE]: { to: withRole(users, Role.FINANCE_DISBURSER).map((u) => person(u)), cc: none },
      [SystemEmailType.LEDGER_APPROVED]: { to: releasers, cc: none },
      [SystemEmailType.LEDGER_REJECTED]: { to: releasers, cc: none },
      [SystemEmailType.CASHBACK_TREND_AUTO]: { to: trend.autoRecipients.map(address), cc: none },
    };
  }
}
