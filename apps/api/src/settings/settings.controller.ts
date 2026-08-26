import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { CustomerInactivitySettingsService } from './customer-inactivity-settings.service';
import { DisbursementSettingsService } from './disbursement-settings.service';
import { UpdateCustomerInactivitySettingsDto } from './dto/update-customer-inactivity-settings.dto';
import { UpdateDisbursementSettingsDto } from './dto/update-disbursement-settings.dto';

@ApiTags('settings')
@ApiBearerAuth()
@StaffOnly()
@Controller()
export class SettingsController {
  constructor(
    private readonly disbursementSettings: DisbursementSettingsService,
    private readonly inactivitySettings: CustomerInactivitySettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('disbursement-settings')
  @RequirePermissions(Permission.DISBURSEMENT_SETTINGS_MANAGE)
  getDisbursementSettings() {
    return this.disbursementSettings.get();
  }

  @Patch('disbursement-settings')
  @RequirePermissions(Permission.DISBURSEMENT_SETTINGS_MANAGE)
  async updateDisbursementSettings(
    @Body() dto: UpdateDisbursementSettingsDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const settings = await this.disbursementSettings.update(dto);
    await this.audit.record({
      actor,
      action: 'disbursement_settings.update',
      entityType: 'disbursementSettings',
      entityId: settings.id,
      metadata: { minDisbursementAmount: settings.minDisbursementAmount },
    });
    return settings;
  }

  @Get('customer-inactivity-settings')
  @RequirePermissions(Permission.CUSTOMER_INACTIVITY_SETTINGS_MANAGE)
  getCustomerInactivitySettings() {
    return this.inactivitySettings.get();
  }

  @Patch('customer-inactivity-settings')
  @RequirePermissions(Permission.CUSTOMER_INACTIVITY_SETTINGS_MANAGE)
  async updateCustomerInactivitySettings(
    @Body() dto: UpdateCustomerInactivitySettingsDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const settings = await this.inactivitySettings.update(dto);
    await this.audit.record({
      actor,
      action: 'customer_inactivity_settings.update',
      entityType: 'customerInactivitySettings',
      entityId: settings.id,
      metadata: {
        noticeAfterDays: settings.noticeAfterDays,
        resetAfterAdditionalDays: settings.resetAfterAdditionalDays,
      },
    });
    return settings;
  }
}
