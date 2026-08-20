import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Product } from '@loyalty/shared';
import { Public } from '../common/decorators/public.decorator';
import { EmailService } from '../common/email/email.service';
import { SchedulerSecretGuard } from '../common/guards/scheduler-secret.guard';
import { PriceRemindersService } from '../prices/price-reminders.service';
import { PricesService } from '../prices/prices.service';

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
}
