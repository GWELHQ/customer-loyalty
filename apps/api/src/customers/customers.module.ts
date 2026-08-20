import { Module } from '@nestjs/common';
import { StationsModule } from '../stations/stations.module';
import { CustomerImportsService } from './customer-imports.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [StationsModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerImportsService],
  exports: [CustomersService, CustomerImportsService],
})
export class CustomersModule {}
