import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { FraudModule } from '../fraud/fraud.module';
import { PricesModule } from '../prices/prices.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SmsModule } from '../sms/sms.module';
import { StationsModule } from '../stations/stations.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [CustomersModule, PricesModule, StationsModule, ReconciliationModule, SmsModule, FraudModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
