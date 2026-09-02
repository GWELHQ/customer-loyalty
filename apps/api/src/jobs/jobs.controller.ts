import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { LedgerStatus, NotificationType, Product, Role, UserStatus } from '@loyalty/shared';
import { CashbackLedgersService } from '../cashback-ledgers/cashback-ledgers.service';
import { Public } from '../common/decorators/public.decorator';
import { EmailService } from '../common/email/email.service';
import { formatEmailCurrency, formatEmailDate } from '../common/email/render-email';
import { SchedulerSecretGuard } from '../common/guards/scheduler-secret.guard';
import { nairobiPreviousMonthKey, nairobiToday } from '../common/time/nairobi';
import { CustomersService } from '../customers/customers.service';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PriceRemindersService } from '../prices/price-reminders.service';
import { PricesService } from '../prices/prices.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { CustomerInactivitySettingsService } from '../settings/customer-inactivity-settings.service';
import { SmsService } from '../sms/sms.service';
import { StationsService } from '../stations/stations.service';
import { UsersService } from '../users/users.service';

/**
 * Endpoints invoked only by Cloud Scheduler (see infra/google-cloud), never
 * by a browser session — hence @Public() (skips the user JWT guard) plus
 * SchedulerSecretGuard (its own shared-secret check).
 */
@ApiExcludeController()
@Public()
@UseGuards(SchedulerSecretGuard)
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly reminders: PriceRemindersService,
    private readonly prices: PricesService,
    private readonly email: EmailService,
    private readonly reconciliation: ReconciliationService,
    private readonly stations: StationsService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly customers: CustomersService,
    private readonly sms: SmsService,
    private readonly inactivitySettings: CustomerInactivitySettingsService,
    private readonly fraudDetection: FraudDetectionService,
    private readonly cashbackLedgers: CashbackLedgersService,
  ) {}

  @Post('price-reminders')
  @HttpCode(HttpStatus.OK)
  async runPriceReminders() {
    const settings = await this.reminders.get();
    if (!settings.enabled) return { sent: false, reason: 'reminders disabled' };
    if (new Date(settings.nextReminderAt) > new Date()) {
      return { sent: false, reason: 'not due yet', nextReminderAt: settings.nextReminderAt };
    }
    if (settings.recipientEmails.length === 0) {
      return { sent: false, reason: 'no recipients configured' };
    }

    const allStations = await this.prices.getCurrentForAllStations();
    const lines = allStations.flatMap(({ station, prices }) =>
      Object.values(Product).map((product) => {
        const price = prices[product];
        return price
          ? `${station.name} — ${product}: ${formatEmailCurrency(price.pricePerLitre)} (effective ${formatEmailDate(price.effectiveFrom)})`
          : `${station.name} — ${product}: no active price set`;
      }),
    );

    await this.email.send(settings.recipientEmails, 'Green Wells: monthly fuel price update reminder', {
      title: 'Monthly fuel price update reminder',
      bodyLines: ["It's time to review next month's PMS/AGO prices.", 'Current prices by station:', ...lines],
    });
    await this.reminders.markSent();

    return { sent: true };
  }

  /**
   * Run once daily at end-of-shift (see infra/google-cloud/DEPLOYMENT.md).
   * For every active station that has recorded no reconciliation totals for
   * today (Nairobi calendar day), nudges its Station Supervisor(s) with an
   * in-app notification — nothing to do if totals are already in.
   */
  @Post('reconciliation-reminders')
  @HttpCode(HttpStatus.OK)
  async runReconciliationReminders() {
    const today = nairobiToday();
    const [stations, users] = await Promise.all([this.stations.list(), this.users.list()]);
    let remindersSent = 0;

    for (const station of stations.filter((s) => s.active)) {
      const supervisors = users.filter((u) => u.role === Role.STATION_SUPERVISOR && u.assignedStationId === station.id);
      if (supervisors.length === 0) continue;

      const daily = await this.reconciliation.listDaily({ stationId: station.id, date: today });
      if (daily.length > 0) continue;

      await this.notifications.notifyMany(
        supervisors.map((u) => u.id),
        {
          type: NotificationType.RECONCILIATION_ALERT,
          title: `Record today's totals for ${station.name}`,
          body: `No reconciliation totals recorded yet for ${station.name} today — record them before end of shift.`,
          linkPath: '/reconciliation',
        },
      );
      remindersSent += 1;
    }

    return { remindersSent };
  }

  /**
   * Run once daily (see infra/google-cloud/DEPLOYMENT.md). Two independent
   * passes: notice customers past noticeAfterDays with no notice sent yet,
   * and reset customers whose notice is now past resetAfterAdditionalDays.
   */
  @Post('customer-inactivity-check')
  @HttpCode(HttpStatus.OK)
  async runCustomerInactivityCheck() {
    const settings = await this.inactivitySettings.get();
    const now = Date.now();
    const noticeCutoff = new Date(now - settings.noticeAfterDays * 24 * 60 * 60 * 1000).toISOString();
    const resetCutoff = new Date(now - settings.resetAfterAdditionalDays * 24 * 60 * 60 * 1000).toISOString();

    const dueForNotice = await this.customers.findDueForInactivityNotice(noticeCutoff);
    let noticesSent = 0;
    for (const customer of dueForNotice) {
      await this.sms.sendInactivityNotice({
        customerPhone: customer.phoneNumber,
        message: `Green Wells: Your loyalty points have been inactive for a while. They'll reset in ${settings.resetAfterAdditionalDays} days unless you make a purchase.`,
      });
      await this.customers.markInactivityNoticeSent(customer.id);
      noticesSent += 1;
    }

    const dueForReset = await this.customers.findDueForInactivityReset(resetCutoff);
    let resetsApplied = 0;
    for (const customer of dueForReset) {
      await this.customers.resetInactiveCashback(customer.id);
      resetsApplied += 1;
    }

    return { noticesSent, resetsApplied };
  }

  /** Run once nightly (see infra/google-cloud/DEPLOYMENT.md) — scans the prior day/week's sales for irregular activity. */
  @Post('fraud-scan')
  @HttpCode(HttpStatus.OK)
  async runFraudScan() {
    return this.fraudDetection.runScan();
  }

  /**
   * Run at 09:00 Nairobi time on the 1st and 2nd of the month (see
   * infra/google-cloud/DEPLOYMENT.md) — chases release of the month that
   * just ended. Station Supervisors are reminded per-station (only for
   * stations still unreleased), RTSM is reminded to release the whole
   * month for approval (only while the ledger hasn't been submitted yet);
   * Admin is CC'd on every email rather than notified directly, since
   * Admin can release any day and isn't the one being chased. The 2nd's
   * reminder additionally warns that the release button disables itself
   * after today, matching assertWithinReleaseWindow on the ledger service.
   */
  @Post('ledger-release-reminders')
  @HttpCode(HttpStatus.OK)
  async runLedgerReleaseReminders() {
    const dayOfMonth = Number(nairobiToday().slice(8, 10));
    if (dayOfMonth !== 1 && dayOfMonth !== 2) {
      return { sent: false, reason: 'not the 1st or 2nd of the month' };
    }

    const month = nairobiPreviousMonthKey();
    const ledger = await this.cashbackLedgers.getOrCreate(month);
    if (ledger.status !== LedgerStatus.OPEN_ACCRUING && ledger.status !== LedgerStatus.READY_FOR_REVIEW) {
      return { sent: false, reason: `${month} already released (status: ${ledger.status})` };
    }

    const [allStations, allUsers] = await Promise.all([this.stations.list(), this.users.list()]);
    const activeStations = allStations.filter((s) => s.active);
    const releasedStationIds = new Set(ledger.stationReleases.map((r) => r.stationId));
    const pendingStations = activeStations.filter((s) => !releasedStationIds.has(s.id));
    const adminEmails = allUsers
      .filter((u) => u.status === UserStatus.ACTIVE && u.role === Role.ADMIN)
      .map((u) => u.email);

    const isSecondReminder = dayOfMonth === 2;
    const disableWarning = "If it isn't released today, the release button will be disabled until next month's cycle.";

    let remindersSent = 0;

    for (const station of pendingStations) {
      const supervisors = allUsers.filter(
        (u) => u.status === UserStatus.ACTIVE && u.role === Role.STATION_SUPERVISOR && u.assignedStationId === station.id,
      );
      if (supervisors.length === 0) continue;

      const body = `${station.name}'s cashback ledger for ${month} is still awaiting release for disbursement.`;
      await this.notifications.notifyMany(
        supervisors.map((u) => u.id),
        {
          type: NotificationType.LEDGER_STATE_CHANGE,
          title: `Release ${station.name}'s ${month} sales`,
          body: isSecondReminder ? `${body} ${disableWarning}` : body,
          linkPath: '/cashback-ledgers',
        },
      );
      await this.email.send(
        supervisors.map((u) => u.email),
        `Green Wells: release ${station.name}'s ${month} sales for disbursement`,
        {
          title: `Release ${station.name} for ${month}`,
          bodyLines: isSecondReminder ? [body, disableWarning] : [body],
        },
        { cc: adminEmails },
      );
      remindersSent += 1;
    }

    const rtsmUsers = allUsers.filter((u) => u.status === UserStatus.ACTIVE && u.role === Role.RTSM);
    if (rtsmUsers.length > 0) {
      const pendingNote =
        pendingStations.length > 0
          ? `${pendingStations.length} station(s) still need releasing: ${pendingStations.map((s) => s.name).join(', ')}.`
          : 'Every station has already released — you just need to submit the month for approval.';
      const body = `${month}'s cashback ledger is still awaiting release for approval. ${pendingNote}`;
      await this.notifications.notifyMany(
        rtsmUsers.map((u) => u.id),
        {
          type: NotificationType.LEDGER_STATE_CHANGE,
          title: `Release ${month} for approval`,
          body: isSecondReminder ? `${body} ${disableWarning}` : body,
          linkPath: '/cashback-ledgers',
        },
      );
      await this.email.send(
        rtsmUsers.map((u) => u.email),
        `Green Wells: release ${month} for approval`,
        {
          title: `Release ${month} for approval`,
          bodyLines: isSecondReminder ? [body, disableWarning] : [body],
        },
        { cc: adminEmails },
      );
      remindersSent += 1;
    }

    return { sent: true, remindersSent, month, dayOfMonth };
  }
}
