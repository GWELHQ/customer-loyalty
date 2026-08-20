import { Module } from '@nestjs/common';
import { PriceRemindersService } from './price-reminders.service';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';

@Module({
  controllers: [PricesController],
  providers: [PricesService, PriceRemindersService],
  exports: [PricesService, PriceRemindersService],
})
export class PricesModule {}
