import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NotificationType, Product, Role } from '@loyalty/shared';
import { Public } from '../common/decorators/public.decorator';
import { EmailService } from '../common/email/email.service';
import { formatEmailCurrency, formatEmailDate } from '../common/email/render-email';
import { SchedulerSecretGuard } from '../common/guards/scheduler-secret.guard';
import { nairobiToday } from '../common/time/nairobi';
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
}
