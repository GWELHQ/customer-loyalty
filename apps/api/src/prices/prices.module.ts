import { Module } from '@nestjs/common';
import { StationsModule } from '../stations/stations.module';
import { UsersModule } from '../users/users.module';
import { PriceRemindersService } from './price-reminders.service';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';

@Module({
  imports: [UsersModule, StationsModule],
  controllers: [PricesController],
  providers: [PricesService, PriceRemindersService],
  exports: [PricesService, PriceRemindersService],
})
export class PricesModule {}
