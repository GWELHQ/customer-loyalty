import { Module } from '@nestjs/common';
import { CustomerInactivitySettingsService } from './customer-inactivity-settings.service';
import { DisbursementSettingsService } from './disbursement-settings.service';
import { SettingsController } from './settings.controller';

@Module({
  controllers: [SettingsController],
  providers: [DisbursementSettingsService, CustomerInactivitySettingsService],
  exports: [DisbursementSettingsService, CustomerInactivitySettingsService],
})
export class SettingsModule {}
