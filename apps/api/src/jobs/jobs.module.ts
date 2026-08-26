import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { FraudModule } from '../fraud/fraud.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricesModule } from '../prices/prices.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SettingsModule } from '../settings/settings.module';
import { SmsModule } from '../sms/sms.module';
import { StationsModule } from '../stations/stations.module';
import { UsersModule } from '../users/users.module';
import { JobsController } from './jobs.controller';

@Module({
  imports: [
    PricesModule,
    ReconciliationModule,
    StationsModule,
    UsersModule,
    NotificationsModule,
    CustomersModule,
    SmsModule,
    SettingsModule,
    FraudModule,
  ],
  controllers: [JobsController],
})
export class JobsModule {}
