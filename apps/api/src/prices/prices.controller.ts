import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, Product } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
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
      metadata: { product: price.product, pricePerLitre: price.pricePerLitre },
    });
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
