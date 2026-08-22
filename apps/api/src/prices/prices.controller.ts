import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, Product, Role, UserStatus } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import { EmailService } from '../common/email/email.service';
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
  history(@Query('product') product?: Product) {
    return this.prices.history(product);
  }

  @Get('prices/current')
  @RequirePermissions(Permission.PRICES_VIEW)
  current() {
    return this.prices.getCurrent();
  }

  @Get('prices/history')
  @RequirePermissions(Permission.PRICES_VIEW)
  explicitHistory(@Query('product') product?: Product) {
    return this.prices.history(product);
  }

  @Post('prices')
  @RequirePermissions(Permission.PRICES_MANAGE)
  async create(@Body() dto: CreatePriceDto, @CurrentUser() actor: StaffPrincipal) {
    const price = await this.prices.create(dto, actor);
    await this.audit.record({
      actor,
      action: 'price.publish',
      entityType: 'productPrice',
      entityId: price.id,
      entityLabel: `${price.product} @ KSh ${price.pricePerLitre}/L`,
      metadata: { product: price.product, pricePerLitre: price.pricePerLitre },
    });

    // Station Supervisors need the new price to reconcile against, and
    // Admins oversee pricing regardless of who published it.
    const recipients = (await this.users.list())
      .filter(
        (u) =>
          u.status === UserStatus.ACTIVE &&
          (u.role === Role.STATION_SUPERVISOR || u.role === Role.ADMIN),
      )
      .map((u) => u.email);
    await this.email.send(
      recipients,
      `Green Wells: new ${price.product} price — KSh ${price.pricePerLitre}/L`,
      `${actor.fullName} published a new ${price.product} price of KSh ${price.pricePerLitre} per litre, effective ${price.effectiveFrom}.`,
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
