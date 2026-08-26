import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NotificationType, Product, Role } from '@loyalty/shared';
import { Public } from '../common/decorators/public.decorator';
import { EmailService } from '../common/email/email.service';
import { SchedulerSecretGuard } from '../common/guards/scheduler-secret.guard';
import { nairobiToday } from '../common/time/nairobi';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PriceRemindersService } from '../prices/price-reminders.service';
import { PricesService } from '../prices/prices.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
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

    const current = await this.prices.getCurrent();
    const lines = Object.values(Product).map((product) => {
      const price = current[product];
      return price
        ? `${product}: KSh ${price.pricePerLitre} (effective ${price.effectiveFrom})`
        : `${product}: no active price set`;
    });

    await this.email.send(
      settings.recipientEmails,
      'Green Wells: monthly fuel price update reminder',
      `It's time to review next month's PMS/AGO prices.\n\nCurrent prices:\n${lines.join('\n')}`,
    );
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

  /** Run once nightly (see infra/google-cloud/DEPLOYMENT.md) — scans the prior day/week's sales for irregular activity. */
  @Post('fraud-scan')
  @HttpCode(HttpStatus.OK)
  async runFraudScan() {
    return this.fraudDetection.runScan();
  }
}
