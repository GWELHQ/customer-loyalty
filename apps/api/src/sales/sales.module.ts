import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { FraudModule } from '../fraud/fraud.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricesModule } from '../prices/prices.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SalesDelegationsModule } from '../sales-delegations/sales-delegations.module';
import { SmsModule } from '../sms/sms.module';
import { StationsModule } from '../stations/stations.module';
import { UsersModule } from '../users/users.module';
import { VehiclePlateChecksModule } from '../vehicle-plate-checks/vehicle-plate-checks.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [
    CustomersModule,
    PricesModule,
    StationsModule,
    ReconciliationModule,
    SmsModule,
    FraudModule,
    VehiclePlateChecksModule,
    SalesDelegationsModule,
    NotificationsModule,
    UsersModule,
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
