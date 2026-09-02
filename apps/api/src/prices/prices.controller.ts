import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, Product, Role, UserStatus } from '@loyalty/shared';
import { assertStationAccessible } from '../common/access/station-scope';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import { EmailService } from '../common/email/email.service';
import { formatEmailCurrency, formatEmailDate } from '../common/email/render-email';
import type { StaffPrincipal } from '../common/types/principal';
import { UsersService } from '../users/users.service';
import { CreatePriceDto } from './dto/create-price.dto';
import { UpdatePriceReminderDto } from './dto/update-price-reminder.dto';
import { PriceRemindersService } from './price-reminders.service';
import { PricesService } from './prices.service';

@ApiTags('prices')
@ApiBearerAuth()
@StaffOnly()
@Controller()
export class PricesController {
  constructor(
    private readonly prices: PricesService,
    private readonly reminders: PriceRemindersService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly email: EmailService,
  ) {}

  @Get('prices')
  @RequirePermissions(Permission.PRICES_VIEW)
  history(@Query('product') product?: Product, @Query('stationId') stationId?: string) {
    return this.prices.history(product, stationId);
  }

  @Get('prices/current')
  @RequirePermissions(Permission.PRICES_VIEW)
  current(@Query('stationId') stationId?: string) {
    return stationId ? this.prices.getCurrent(stationId) : this.prices.getCurrentForAllStations();
  }

  @Get('prices/history')
  @RequirePermissions(Permission.PRICES_VIEW)
  explicitHistory(@Query('product') product?: Product, @Query('stationId') stationId?: string) {
    return this.prices.history(product, stationId);
  }

  @Post('prices')
  @RequirePermissions(Permission.PRICES_MANAGE)
  async create(@Body() dto: CreatePriceDto, @CurrentUser() actor: StaffPrincipal) {
    // A Station Supervisor holds PRICES_MANAGE too, but only for their own
    // station — Admin/RTSM are unrestricted (assertStationAccessible is a
    // no-op for every other role).
    assertStationAccessible(actor, dto.stationId);
    const price = await this.prices.create(dto, actor);
    await this.audit.record({
      actor,
      action: 'price.publish',
      entityType: 'productPrice',
      entityId: price.id,
      entityLabel: `${price.product} @ KSh ${price.pricePerLitre}/L — ${price.stationNameAtPrice}`,
      metadata: { product: price.product, pricePerLitre: price.pricePerLitre, stationId: price.stationId },
    });

    // Only the affected station's own Station Supervisor(s) need the new
    // price to reconcile against now that prices are per-station — Admins
    // oversee pricing everywhere regardless of who published it.
    const recipients = (await this.users.list())
      .filter(
        (u) =>
          u.status === UserStatus.ACTIVE &&
          (u.role === Role.ADMIN ||
            (u.role === Role.STATION_SUPERVISOR && u.assignedStationId === price.stationId)),
      )
      .map((u) => u.email);
    await this.email.send(
      recipients,
      `Green Wells: new ${price.product} price — ${formatEmailCurrency(price.pricePerLitre)}/L (${price.stationNameAtPrice})`,
      {
        title: `New ${price.product} price published`,
        bodyLines: [
          `${actor.fullName} published a new ${price.product} price of ${formatEmailCurrency(price.pricePerLitre)} per litre for ${price.stationNameAtPrice}, effective ${formatEmailDate(price.effectiveFrom)}.`,
        ],
      },
    );

    return price;
  }

  @Get('price-reminders')
  @RequirePermissions(Permission.PRICES_VIEW)
  getReminderSettings() {
    return this.reminders.get();
  }

  @Patch('price-reminders')
  @RequirePermissions(Permission.PRICES_MANAGE)
  async updateReminderSettings(
    @Body() dto: UpdatePriceReminderDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const settings = await this.reminders.update(dto);
    await this.audit.record({
      actor,
      action: 'price_reminder.update',
      entityType: 'priceReminderSetting',
      entityId: settings.id,
    });
    return settings;
  }
}
