import { Module } from '@nestjs/common';
import { CustomerRegistrationsModule } from '../customer-registrations/customer-registrations.module';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricesModule } from '../prices/prices.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SalesModule } from '../sales/sales.module';
import { SmsModule } from '../sms/sms.module';
import { StationsModule } from '../stations/stations.module';
import { UsersModule } from '../users/users.module';
import { MobileController } from './mobile.controller';
import { SyncOperationsService } from './sync-operations.service';

@Module({
  imports: [
    StationsModule,
    PricesModule,
    CustomersModule,
    SalesModule,
    ReconciliationModule,
    CustomerRegistrationsModule,
    NotificationsModule,
    UsersModule,
    SmsModule,
  ],
  controllers: [MobileController],
  providers: [SyncOperationsService],
})
export class MobileModule {}
