import { Module } from '@nestjs/common';
import { CashbackTrendController } from './cashback-trend.controller';
import { CashbackTrendService } from './cashback-trend.service';

@Module({
  controllers: [CashbackTrendController],
  providers: [CashbackTrendService],
  exports: [CashbackTrendService],
})
export class CashbackTrendModule {}
