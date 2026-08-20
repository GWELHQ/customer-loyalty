import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PricesModule } from '../prices/prices.module';
import { SalesModule } from '../sales/sales.module';
import { StationsModule } from '../stations/stations.module';
import { CustomerRegistrationsController } from './customer-registrations.controller';
import { CustomerRegistrationsService } from './customer-registrations.service';

@Module({
  imports: [CustomersModule, StationsModule, PricesModule, SalesModule],
  controllers: [CustomerRegistrationsController],
  providers: [CustomerRegistrationsService],
  exports: [CustomerRegistrationsService],
})
export class CustomerRegistrationsModule {}
